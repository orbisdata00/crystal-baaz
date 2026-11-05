import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileMode} from '../src/shopping-experience.js';
test('mobile controls coordinate route and confirmed quantity',()=>{assert.equal(mobileMode('home',0),'navigation');assert.equal(mobileMode('collections',1),'view-cart');assert.equal(mobileMode('search',2),'view-cart');assert.equal(mobileMode('product',0),'product');assert.equal(mobileMode('product',1),'product-cart');assert.equal(mobileMode('cart',2),'cart');for(const route of ['home','product','cart'])assert.equal(mobileMode(route,2,true),'hidden');});
