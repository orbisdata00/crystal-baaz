// Select only media supplied by this Shopify product. Metadata is a heuristic,
// not visual certification: unknown artwork stays unchanged and is reviewable.
const DOCUMENT_PATTERN = /(?:certificate|certification|how[\s_-]*(?:to[\s_-]*)?(?:use|clean|charge)|crystal[\s_-]*(?:care|guide)|care[\s_-]*(?:guide|instruction)|instructions?|size[\s_-]*chart|measurement[\s_-]*chart|benefits?[\s_-]*chart|infographic)/i;
function nodes(connection) { return Array.isArray(connection) ? connection : connection?.nodes || connection?.edges?.map(edge => edge.node) || []; }
function secureUrl(value) {
  try { const url=new URL(value);return url.protocol==='https:'?url.href:null; } catch { return null; }
}
function galleryImage(media) {
  const url=secureUrl(media?.image?.url||media?.url);
  if(!url)return null;
  return {id:media.id||url,type:'image',src:url,alt:media.image?.altText||media.altText||media.alt||'',poster:url};
}
function galleryVideo(media) {
  const source=(media?.sources||[]).map(item=>({...item,url:secureUrl(item?.url)})).filter(item=>item.url)
    .sort((a,b)=>Number(b.mimeType==='video/mp4'||b.format==='mp4')-Number(a.mimeType==='video/mp4'||a.format==='mp4'))[0];
  if(!source)return null;
  const poster=secureUrl(media.previewImage?.url||media.image?.url);
  return {id:media.id||source.url,type:'video',src:source.url,mimeType:source.mimeType||undefined,poster,alt:media.alt||media.altText||''};
}
function galleryExternalVideo(media) {
  const url=secureUrl(media?.embeddedUrl);
  if(!url)return null;
  let host='';try{host=new URL(url).hostname.toLowerCase();}catch{}
  if(!/(^|\.)youtube(?:-nocookie)?\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/.test(host))return null;
  return {id:media.id||url,type:'external-video',src:url,poster:secureUrl(media.previewImage?.url),alt:media.alt||media.altText||''};
}
export function isDocumentMedia(media) {
  let path=''; try { path=decodeURIComponent(new URL(media?.url).pathname); } catch { path=String(media?.url||''); }
  // The supplied screenshots and a directly inspected Shopify original identify
  // this merchant's Vidhi_1 filename family as the repeated care-instruction sheet.
  return /(?:^|\/)Vidhi_1(?:_|\.)/i.test(path)||DOCUMENT_PATTERN.test(`${media?.altText||''} ${path}`);
}
export function selectProductMedia(product = {}) {
  const declared=[product.featuredImage,...nodes(product.images)].filter(media=>media?.url);
  const seen=new Set();const imageMedia=declared.filter(media=>{if(seen.has(media.url))return false;seen.add(media.url);return true;});
  const first=imageMedia[0];const chosen=imageMedia.find(media=>!isDocumentMedia(media))||first;
  const reviewRequired=Boolean(imageMedia.length&&imageMedia.every(isDocumentMedia));
  const suppliedMedia=nodes(product.media);
  const mediaGallery=suppliedMedia.flatMap(media=>{
    if(media?.mediaContentType==='IMAGE')return [galleryImage(media)].filter(Boolean);
    if(media?.mediaContentType==='VIDEO')return [galleryVideo(media)].filter(Boolean);
    if(media?.mediaContentType==='EXTERNAL_VIDEO')return [galleryExternalVideo(media)].filter(Boolean);
    return [];
  });
  const galleryUrls=new Set(mediaGallery.filter(item=>item.type==='image').map(item=>item.src));
  const additionalImages=imageMedia.map(galleryImage).filter(item=>item&&!galleryUrls.has(item.src));
  let galleryMedia=mediaGallery.length?[...mediaGallery,...additionalImages]:imageMedia.map(galleryImage).filter(Boolean);
  if(chosen?.url){
    const chosenIndex=galleryMedia.findIndex(item=>item.type==='image'&&item.src===chosen.url);
    if(chosenIndex>0)galleryMedia=[galleryMedia[chosenIndex],...galleryMedia.slice(0,chosenIndex),...galleryMedia.slice(chosenIndex+1)];
  }
  return {image:chosen?.url||null,images:imageMedia.map(media=>media.url),imageMedia,galleryMedia,
    selectionReason:!chosen?'no_shopify_image':reviewRequired?'document_metadata_only_review':chosen===first?'featured_or_first_preserved':'same_product_non_document_metadata',
    reviewRequired};
}
export function verifiedDiscount({price,compareAt,currencyCode,compareAtCurrencyCode}={}) {
  const valid=value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0;
  if(!valid(price)||!valid(compareAt)||Number(compareAt)<=Number(price))return null;
  if(!/^[A-Z]{3}$/.test(currencyCode||'')||currencyCode!==compareAtCurrencyCode)return null;
  const percentage=Math.round((1-Number(price)/Number(compareAt))*100);
  return percentage>0&&percentage<100?percentage:null;
}
