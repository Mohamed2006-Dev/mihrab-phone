const REPORT_EMAIL = 'anonymous.acc.unkown@gmail.com';
const DEFAULT_ISSUES = 'https://github.com/Mohamed2006-Dev/mihrab-phone/issues';
function issueBase(value = DEFAULT_ISSUES) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('رابط git-issues غير صالح.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/[\w.-]+\/[\w.-]+\/issues(?:\/new)?\/?$/.test(url.pathname)
  )
    throw Error('يجب أن يكون git-issues رابط Issues لمستودع GitHub عبر HTTPS.');
  return (
    url.origin +
    url.pathname
      .replace(/\/(?:new\/?)?$/, '')
      .replace(/\/$/, '')
      .replace(/\/new$/, '')
  );
}
function buildReport(payload, issues, recipient = REPORT_EMAIL) {
  if(!/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(recipient))throw Error("بريد استقبال البلاغات غير صالح.");
  if (!payload || !['github', 'gmail'].includes(payload.channel))
    throw Error('اختر منصة تبليغ صحيحة.');
  const scope = typeof payload.scope === 'string' ? payload.scope.trim() : '',
    description = typeof payload.description === 'string' ? payload.description.trim() : '';
  if (
    !scope ||
    scope.length > 120 ||
    /[\r\n]/.test(scope) ||
    !description ||
    description.length > 8000
  )
    throw Error('راجع نطاق الخطأ ووصفه.');
  const title = '[محراب] ' + scope,
    body = 'نطاق الخطأ: ' + scope + '\n\nوصف الخطأ:\n' + description;
  if(payload.channel==='gmail'){
    const full='mailto:'+recipient+'?subject='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
    const copyRequired=full.length>7000;
    return {url:copyRequired?'mailto:'+recipient:full,copyRequired,email:{to:recipient,subject:title,body},text:title+'\n\n'+body};
  }
  const base=issueBase(issues)+'/new';
  const url=new URL(base);url.searchParams.set('title',title);url.searchParams.set('body',body);
  const full=url.href,copyRequired=full.length>7000;
  return {url:copyRequired?base:full,copyRequired,text:title+'\n\n'+body};
}
module.exports = { buildReport, issueBase, REPORT_EMAIL, DEFAULT_ISSUES };
