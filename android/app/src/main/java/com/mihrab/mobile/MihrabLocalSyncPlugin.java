package com.mihrab.mobile;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "MihrabLocalSync", permissions = {
    @com.getcapacitor.annotation.Permission(alias="camera", strings={android.Manifest.permission.CAMERA})
})
public class MihrabLocalSyncPlugin extends Plugin {
    private static final String KEY = "mihrab.local-sync.v1";
    private static final int MAX = 256 * 1024;

    @PluginMethod public void cameraPermission(PluginCall call) {
        if (getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED) call.resolve();
        else requestPermissionForAlias("camera", call, "cameraResult");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void cameraResult(PluginCall call) {
        if (getPermissionState("camera") == com.getcapacitor.PermissionState.GRANTED) call.resolve();
        else call.reject("لم يُمنح إذن الكاميرا. يمكنك قراءة الرمز من صورة.");
    }

    private SecretKey storageKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY, null);
    }

    @PluginMethod public void loadState(PluginCall call) {
        try {
            String encoded = getContext().getSharedPreferences(KEY, Context.MODE_PRIVATE).getString("sealed", null);
            JSObject result = new JSObject();
            if (encoded != null) {
                byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, storageKey(), new GCMParameterSpec(128, packed, 0, 12));
                result.put("state", new String(cipher.doFinal(packed, 12, packed.length - 12), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception error) { call.reject("تعذر فتح مخزن الربط المحلي.", error); }
    }

    @PluginMethod public void saveState(PluginCall call) {
        try {
            String state = call.getString("state", "");
            if (state.length() > MAX) throw new IllegalArgumentException();
            android.content.SharedPreferences.Editor editor =
                getContext().getSharedPreferences(KEY, Context.MODE_PRIVATE).edit();
            if (state.isEmpty()) editor.remove("sealed");
            else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, storageKey());
                ByteArrayOutputStream packed = new ByteArrayOutputStream();
                packed.write(cipher.getIV());
                packed.write(cipher.doFinal(state.getBytes(StandardCharsets.UTF_8)));
                editor.putString("sealed", Base64.encodeToString(packed.toByteArray(), Base64.NO_WRAP));
            }
            if (!editor.commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) { call.reject("تعذر حفظ بيانات الربط.", error); }
    }

    private static boolean privateIp(String host) {
        if (host == null || !host.matches("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}")) return false;
        int[] bytes = Arrays.stream(host.split("\\.")).mapToInt(Integer::parseInt).toArray();
        for (int value : bytes) if (value > 255) return false;
        return bytes[0] == 10 || (bytes[0] == 192 && bytes[1] == 168) ||
                (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31);
    }

    @PluginMethod public void exchange(PluginCall call) {
        new Thread(() -> {
            HttpsURLConnection connection = null;
            try {
                String host = call.getString("host");
                String pin = call.getString("pin", "");
                String route = call.getString("route", "");
                if (!privateIp(host) || !pin.matches("[0-9a-f]{64}") ||
                        !Arrays.asList("/pair", "/pair-status", "/exchange", "/unlink", "/drop-location", "/configure").contains(route))
                    throw new IllegalArgumentException("invalid_local_endpoint");
                byte[] expected = new byte[32];
                for (int i = 0; i < expected.length; i++)
                    expected[i] = (byte) Integer.parseInt(pin.substring(i * 2, i * 2 + 2), 16);
                X509TrustManager verifier = new X509TrustManager() {
                    @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    @Override public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException {
                        throw new CertificateException("client_certificate_not_expected");
                    }
                    @Override public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
                        if (chain == null || chain.length == 0) throw new CertificateException("missing_certificate");
                        chain[0].checkValidity();
                        try {
                            byte[] fingerprint = MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded());
                            if (!MessageDigest.isEqual(expected, fingerprint)) throw new CertificateException("wrong_device_pin");
                        } catch (java.security.GeneralSecurityException error) { throw new CertificateException(error); }
                    }
                };
                SSLContext tls = SSLContext.getInstance("TLSv1.3");
                tls.init(null, new X509TrustManager[]{verifier}, new SecureRandom());
                connection = (HttpsURLConnection) new URL("https://" + host + ":17777" + route).openConnection(java.net.Proxy.NO_PROXY);
                connection.setSSLSocketFactory(tls.getSocketFactory());
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(4500);
                connection.setReadTimeout(6500);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                String token = call.getString("token", "");
                if (!token.isEmpty()) {
                    if (!token.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("invalid_token");
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                }
                byte[] body = call.getString("body", "{}").getBytes(StandardCharsets.UTF_8);
                if (body.length > MAX) throw new IllegalArgumentException("payload_too_large");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(body); }
                int status = connection.getResponseCode();
                JSObject result = new JSObject();
                result.put("status", status);
                if (status == 200) {
                    try (java.io.InputStream input = connection.getInputStream()) {
                        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                        byte[] chunk = new byte[8192];
                        int n;
                        while ((n = input.read(chunk)) != -1) {
                            if (bytes.size() + n > MAX) throw new IllegalStateException("oversized_response");
                            bytes.write(chunk, 0, n);
                        }
                        result.put("body", bytes.toString("UTF-8"));
                    }
                }
                call.resolve(result);
            } catch (Exception error) { android.util.Log.w("MihrabLocalSync", error.getClass().getSimpleName()); call.reject("تعذر الاتصال بالحاسوب عبر الشبكة المحلية الموثّقة."); }
            finally { if (connection != null) connection.disconnect(); }
        }, "mihrab-local-sync").start();
    }
}
