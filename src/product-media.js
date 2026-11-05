// Select only media supplied by this Shopify product. Metadata is a heuristic,
// not visual certification: unknown artwork stays unchanged and is reviewable.
const DOCUMENT_PATTERN = /(?:certificate|certification|how[\s_-]*(?:to[\s_-]*)?(?:use|clean|charge)|crystal[\s_-]*(?:care|guide)|care[\s_-]*(?:guide|instruction)|instructions?|size[\s_-]*chart|measurement[\s_-]*chart|benefits?[\s_-]*chart|infographic)/i;
function nodes(connection) { return Array.isArray(connection) ? connection : connection?.nodes || connection?.edges?.map(edge => edge.node) || []; }
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
  return {image:chosen?.url||null,images:imageMedia.map(media=>media.url),imageMedia,
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
