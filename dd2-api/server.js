const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 10000;
const MAX_PAGES = 6;
const TIMEOUT_MS = 12000;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}
function text(html) {
  return String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<!--([\s\S]*?)-->/g,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();
}
function meta(html, name) {
  const safe = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
    const value = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (key && value && key[1].toLowerCase() === String(name).toLowerCase()) return value[1].trim();
  }
  return '';
}
function count(html, re) { return (html.match(re) || []).length; }
function extractLinks(html, base) {
  const out=[]; const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(html)) && out.length<50) {
    try { const u=new URL(m[1],base); if(['http:','https:'].includes(u.protocol) && u.hostname===new URL(base).hostname && !/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|docx?)(\?|$)/i.test(u.pathname)) out.push({url:u.href,label:text(m[2]).slice(0,100)}); } catch {}
  }
  return out;
}
async function fetchPage(url) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  const started=Date.now();
  try {
    const r=await fetch(url,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':'TheDoctorApproach-DD2/1.0 (+public website diagnostic)'}});
    const html=await r.text();
    return {requestedUrl:url,url:r.url,status:r.status,ok:r.ok,html,ms:Date.now()-started,contentType:r.headers.get('content-type')||''};
  } finally { clearTimeout(timer); }
}
function inspect(p) {
  const h=p.html; const title=(h.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'';
  const headings=[...h.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>text(m[1])).filter(Boolean);
  const h2=count(h,/<h2\b/gi), forms=count(h,/<form\b/gi), inputs=count(h,/<input\b/gi)+count(h,/<textarea\b/gi);
  const links=extractLinks(h,p.url);
  const cta=links.filter(x=>/contact|quote|book|call|enquir|estimate|get started|appointment|request/i.test(x.label+' '+x.url));
  const tel=/href\s*=\s*["']tel:/i.test(h), mail=/href\s*=\s*["']mailto:/i.test(h);
  const viewport=/<meta[^>]+name=["']viewport["']/i.test(h);
  const desc=meta(h,'description'), og=meta(h,'og:description')||meta(h,'og:title');
  const schema=/<script[^>]+type=["']application\/ld\+json["']/i.test(h);
  const reviews=/aggregateRating|reviewCount|ratingValue|customer reviews|testimonials|what our customers say/i.test(h);
  const trust=/accredit|certif|insured|insurance|guarantee|warranty|member of|trade association|trustpilot|checkatrade|which\?/i.test(h);
  const words=text(h).split(/\s+/).filter(Boolean).length;
  const img=count(h,/<img\b/gi), alt=count(h,/<img\b[^>]*\balt\s*=/gi);
  return {url:p.url,status:p.status,title:text(title),description:desc,h1:headings,h2Count:h2,wordCount:words,formCount:forms,inputCount:inputs,internalLinks:links.length,ctaLinks:cta.slice(0,8),telephoneLink:tel,emailLink:mail,mobileViewport:viewport,structuredData:schema,reviewSignals:reviews,trustSignals:trust,imageCount:img,imagesWithAlt:alt,loadMs:p.ms,contentType:p.contentType};
}
function scorePage(p) {
  let visibility=0, trust=0, conversion=0, retention=0;
  if(p.title) visibility+=20; if(p.description) visibility+=20; if(p.h1.length===1) visibility+=20; if(p.wordCount>=250) visibility+=20; if(p.structuredData) visibility+=10; if(p.internalLinks>=4) visibility+=10;
  if(p.trustSignals) trust+=25; if(p.reviewSignals) trust+=25; if(p.structuredData) trust+=10; if(p.telephoneLink) trust+=15; if(p.emailLink) trust+=10; if(p.title&&p.description) trust+=15;
  if(p.mobileViewport) conversion+=20; if(p.formCount>0) conversion+=25; if(p.ctaLinks.length>0) conversion+=25; if(p.telephoneLink) conversion+=15; if(p.h1.length>0) conversion+=10; if(p.wordCount>=150) conversion+=5;
  if(p.formCount>0) retention+=15; if(p.emailLink) retention+=15; if(p.reviewSignals) retention+=15; if(/newsletter|subscribe|updates|follow us|facebook|instagram|linkedin/i.test(JSON.stringify(p))) retention+=15; if(/blog|resources|guides|news|articles/i.test(JSON.stringify(p))) retention+=20; if(p.internalLinks>=5) retention+=20;
  return {Visibility:Math.min(100,visibility),Trust:Math.min(100,trust),Conversion:Math.min(100,conversion),Retention:Math.min(100,retention)};
}
function finding(area,title,observation,implication,priority,evidence) { return {area,driver:area,title,observation,commercialImplication:implication,priority,evidenceStrength:'Observed',status:'Observed on scanned page',evidence}; }
async function diagnose(raw) {
  let url=String(raw||'').trim(); if(!/^https?:\/\//i.test(url)) url='https://'+url;
  let parsed; try { parsed=new URL(url); } catch { throw new Error('Enter a valid website address.'); }
  if(!['http:','https:'].includes(parsed.protocol)) throw new Error('Only public HTTP or HTTPS websites can be scanned.');
  const home=await fetchPage(parsed.href);
  if(!home.ok) throw new Error('The website returned HTTP '+home.status+'.');
  const homepage=inspect(home); const candidates=extractLinks(home.html,home.url).filter(x=>x.url!==home.url);
  const priority=candidates.sort((a,b)=>scoreLink(b)-scoreLink(a)).slice(0,MAX_PAGES-1);
  const pages=[homepage];
  for(const item of priority) { try { const p=await fetchPage(item.url); if(p.ok && /text\/html/i.test(p.contentType)) pages.push(inspect(p)); } catch {} }
  const avg={}; for(const k of ['Visibility','Trust','Conversion','Retention']) avg[k]=Math.round(pages.reduce((s,p)=>s+scorePage(p)[k],0)/pages.length);
  const overall=Math.round(Object.values(avg).reduce((a,b)=>a+b,0)/4);
  const findings=[];
  if(!homepage.title) findings.push(finding('Visibility','Homepage title tag not detected','No HTML title tag was detected on the homepage.','Search results may have less useful page-title context.','High','Homepage HTML'));
  if(!homepage.description) findings.push(finding('Visibility','Meta description not detected','No meta description was detected on the homepage.','The search snippet may be generated from page content rather than a deliberate description.','Medium','Homepage HTML'));
  if(homepage.h1.length===0) findings.push(finding('Visibility','Main heading not detected','No H1 heading was detected on the homepage.','The page may be less clear to users and automated systems about its primary topic.','Medium','Homepage HTML'));
  if(homepage.h1.length>1) findings.push(finding('Visibility','Multiple H1 headings detected','The homepage contains '+homepage.h1.length+' H1 headings.','Review heading structure for a clear primary page topic; multiple H1s are not automatically an SEO error.','Low','Homepage HTML'));
  if(!homepage.mobileViewport) findings.push(finding('Conversion','Mobile viewport declaration not detected','The homepage HTML did not include a standard viewport meta tag.','Mobile presentation may need a technical check.','High','Homepage HTML'));
  if(homepage.ctaLinks.length===0 && homepage.formCount===0 && !homepage.telephoneLink) findings.push(finding('Conversion','Clear enquiry route not detected','No common enquiry CTA link, form or click-to-call link was detected on the homepage.','A visitor may need more effort to find the next step; confirm this visually and on mobile.','High','Homepage links and forms'));
  if(homepage.formCount===0) findings.push(finding('Conversion','No HTML form detected on homepage','No form element was detected in the homepage HTML.','If lead capture is a goal, verify whether a clear alternative enquiry route exists.','Medium','Homepage HTML'));
  if(!homepage.trustSignals) findings.push(finding('Trust','Trust and accreditation terms not detected','The scanned homepage text did not contain common accreditation, insurance or warranty terms.','Confirm whether credentials are available on another page or represented visually.','Medium','Homepage visible text'));
  if(!homepage.reviewSignals) findings.push(finding('Trust','Review/testimonial signals not detected','Common review, rating or testimonial markers were not detected in the homepage HTML.','Check whether verified reviews and customer evidence are presented elsewhere or loaded dynamically.','Medium','Homepage HTML'));
  if(!homepage.structuredData) findings.push(finding('Visibility','Structured data not detected','No JSON-LD structured-data block was detected on the homepage.','Check whether relevant business or service structured data is appropriate and available elsewhere.','Low','Homepage HTML'));
  if(homepage.wordCount<180) findings.push(finding('Content & Authority','Limited homepage text detected','Approximately '+homepage.wordCount+' words were extracted from the homepage HTML.','Check whether key service details and customer questions are answered clearly across the site.','Low','Homepage text extraction'));
  if(homepage.imageCount>0 && homepage.imagesWithAlt<homepage.imageCount) findings.push(finding('Technical Experience','Some images lack detected alt attributes','Detected '+homepage.imagesWithAlt+' alt attributes across '+homepage.imageCount+' images.','Review missing or empty alternative text for meaningful images.','Medium','Homepage image tags'));
  const primary=[...Object.entries(avg)].sort((a,b)=>a[1]-b[1])[0];
  const pageSummary=pages.map(p=>({url:p.url,status:p.status,title:p.title,wordCount:p.wordCount,loadMs:p.loadMs}));
  return {success:true,apiVersion:'DD2-1.0',scan:{website:home.url,businessName:homepage.title||parsed.hostname,scannedAt:new Date().toISOString(),pageCount:pages.length,methodology:'DD2 public-website evidence scan; limited to accessible HTML and detectable signals.',dataAvailability:'This scan cannot observe private analytics, actual enquiries, conversion rates, retention or revenue.'},overall:{score:overall,label:overall<40?'Weak':overall<60?'Developing':overall<80?'Strong':'Leading'},drivers:Object.entries(avg).map(([name,score])=>({name,driver:name,score,status:score<40?'Weak':score<60?'Developing':score<80?'Strong':'Leading'})),primary:{title:'Potential Gap: '+primary[0],name:primary[0],observation:'This driver received the lowest relative signal score in this scan ('+primary[1]+'/100). This is a prioritisation cue, not proof of commercial loss.',commercialImplication:'Validate this area with the business owner and any available analytics before recommending action.'},findings,scanPages:pageSummary,evidenceSummary:{pagesExamined:pages.length,homepageSignals:homepage},limitations:['Only publicly accessible HTML was examined.','Dynamic content, blocked pages and visual-only content may be missed.','Scores are heuristic indicators, not rankings or guarantees.','Retention and actual revenue performance require business-owned data.']};
}
function scoreLink(x) { const s=(x.label+' '+x.url).toLowerCase(); let n=0; if(/service|about|contact|review|testimonial|project|roof|dental|treatment|blog|guide|price|quote/i.test(s)) n+=2; if(/privacy|cookie|terms|login/i.test(s)) n-=5; return n; }
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
  if(req.method==='GET' && ['/health','/api/health'].includes(new URL(req.url,'http://localhost').pathname)) return send(res,200,{success:true,service:'doctor-approach-dd2-api',version:'1.0.0',status:'ok'});
  if(req.method==='GET' && new URL(req.url,'http://localhost').pathname==='/') return send(res,200,{service:'The Doctor Approach DD2 API',version:'1.0.0',endpoints:{health:'GET /health',diagnose:'POST /api/dd2/diagnose'},note:'Independent DD2 scan API.'});
  if(req.method==='POST' && ['/api/dd2/diagnose','/api/diagnose'].includes(new URL(req.url,'http://localhost').pathname)){
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>20000)req.destroy()});req.on('end',async()=>{try{const input=JSON.parse(body||'{}');const site=input.website||input.url;if(!site) return send(res,400,{success:false,error:'website is required'});const data=await diagnose(site);return send(res,200,data)}catch(e){return send(res,502,{success:false,error:e.message||'Scan failed'})}});
    return;
  }
  return send(res,404,{success:false,error:'Not found'});
});
server.listen(PORT,'0.0.0.0',()=>console.log('DD2 API listening on '+PORT));
