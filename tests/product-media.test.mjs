import test from 'node:test';import assert from 'node:assert/strict';
import {selectProductMedia,isDocumentMedia,verifiedDiscount} from '../src/product-media.js';
import {loadShopifyCatalogPage} from '../src/shopify.js';
import {shopifyConfig} from '../src/config.js';
const photo={url:'https://cdn.shopify.com/a/bracelet.jpg',altText:'Bracelet on a table'},guide={url:'https://cdn.shopify.com/a/how-to-use-your-crystal.png',altText:null};
test('featured photograph is preserved; duplicates removed without importing unrelated media',()=>{const result=selectProductMedia({featuredImage:photo,images:{nodes:[photo,guide]}});assert.equal(result.image,photo.url);assert.deepEqual(result.images,[photo.url,guide.url]);assert.equal(result.reviewRequired,false);});
test('same product photograph replaces document-like featured metadata',()=>{const result=selectProductMedia({featuredImage:guide,images:{nodes:[guide,photo]}});assert.equal(result.image,photo.url);assert.equal(result.selectionReason,'same_product_non_document_metadata');assert.equal(result.images[0],guide.url);});
test('document-only gallery remains genuine and explicitly flagged',()=>{const result=selectProductMedia({images:{edges:[{node:guide}]}});assert.equal(result.image,guide.url);assert.equal(result.reviewRequired,true);});
test('missing and unclassified images are not invented or silently rejected',()=>{assert.equal(selectProductMedia({}).image,null);const plain={url:'https://cdn.shopify.com/a/991.jpg',altText:''};assert.equal(selectProductMedia({images:[plain]}).image,plain.url);assert.equal(isDocumentMedia({url:'https://cdn.shopify.com/a/991.jpg',altText:'Certificate of authenticity'}),true);});
test('gallery keeps Shopify media order, removes duplicate images, and accepts only secure supported videos',()=>{const video={id:'video-1',mediaContentType:'VIDEO',alt:'Bracelet video',previewImage:{url:'https://cdn.shopify.com/a/video-poster.jpg'},sources:[{url:'https://cdn.shopify.com/videos/bracelet.webm',mimeType:'video/webm',format:'webm'},{url:'https://cdn.shopify.com/videos/bracelet.mp4',mimeType:'video/mp4',format:'mp4'}]};const invalid={id:'external-unsafe',mediaContentType:'EXTERNAL_VIDEO',embeddedUrl:'https://example.com/embed/1'};const result=selectProductMedia({featuredImage:photo,images:{nodes:[photo,guide]},media:{nodes:[{id:'photo',mediaContentType:'IMAGE',alt:'Bracelet',image:photo},video,invalid]}});assert.deepEqual(result.galleryMedia.map(media=>media.type),['image','video','image']);assert.equal(result.galleryMedia[1].src,'https://cdn.shopify.com/videos/bracelet.mp4');assert.equal(result.galleryMedia[1].poster,'https://cdn.shopify.com/a/video-poster.jpg');assert.equal(result.galleryMedia[2].src,guide.url);});
test('supported external Shopify video hosts are retained as media items',()=>{const result=selectProductMedia({media:{nodes:[{id:'youtube-1',mediaContentType:'EXTERNAL_VIDEO',embeddedUrl:'https://www.youtube.com/embed/abc',previewImage:{url:'https://cdn.shopify.com/a/poster.jpg'}}]}});assert.equal(result.galleryMedia[0].type,'external-video');assert.equal(result.galleryMedia[0].src,'https://www.youtube.com/embed/abc');});
test('discount requires valid exact variant amounts and matching currencies',()=>{assert.equal(verifiedDiscount({price:290,compareAt:1189,currencyCode:'INR',compareAtCurrencyCode:'INR'}),76);for(const pair of [{price:null,compareAt:100},{price:0,compareAt:100},{price:100,compareAt:90},{price:NaN,compareAt:100},{price:'',compareAt:100}])assert.equal(verifiedDiscount({...pair,currencyCode:'INR',compareAtCurrencyCode:'INR'}),null);assert.equal(verifiedDiscount({price:10,compareAt:100,currencyCode:'INR',compareAtCurrencyCode:'USD'}),null);assert.equal(verifiedDiscount({price:10,compareAt:100}),null);});

test('merchant Vidhi care-sheet filename family is flagged while other photos stay unknown',()=>{assert.equal(isDocumentMedia({url:'https://cdn.shopify.com/files/Vidhi_1_639bddeb.png?v=123'}),true);assert.equal(isDocumentMedia({url:'https://cdn.shopify.com/files/Vidhi-bracelet-photo.jpg'}),false);});

test('full Shopify catalog requests several product images for swipeable product cards',async()=>{
 const oldFetch=globalThis.fetch,oldToken=shopifyConfig.storefrontAccessToken;
 const second={url:'https://cdn.shopify.com/a/bracelet-detail.jpg',altText:'Bracelet detail',width:900,height:900};
 shopifyConfig.storefrontAccessToken='test-public-token';
 globalThis.fetch=async(_url,options)=>{
  const {query}=JSON.parse(options.body);
  assert.match(query,/images\(first:\s*5\)\s*\{\s*nodes\s*\{\s*url altText width height\s*\}/);
  return new Response(JSON.stringify({data:{products:{nodes:[{
   id:'gid://shopify/Product/991',handle:'image-gallery-test',title:'Image gallery test',
   featuredImage:photo,images:{nodes:[photo,second],pageInfo:{hasNextPage:false,endCursor:null}},
   priceRange:{minVariantPrice:{amount:'60.00',currencyCode:'INR'}},
   variants:{nodes:[{id:'gid://shopify/ProductVariant/991',title:'Default Title',selectedOptions:[{name:'Title',value:'Default Title'}],sku:'TEST-991',availableForSale:true,price:{amount:'60.00',currencyCode:'INR'},compareAtPrice:null}],pageInfo:{hasNextPage:false,endCursor:null}},
   options:[],collections:{nodes:[]},productType:'Ring',tags:[],availableForSale:true,
  }],pageInfo:{hasNextPage:false,endCursor:null}}}}),{status:200,headers:{'content-type':'application/json'}});
 };
 try {
  const result=await loadShopifyCatalogPage({first:1,after:'image-gallery-test'});
  assert.deepEqual(result.products[0].galleryMedia.map(item=>item.src),[photo.url,second.url]);
 } finally {globalThis.fetch=oldFetch;shopifyConfig.storefrontAccessToken=oldToken;}
});
