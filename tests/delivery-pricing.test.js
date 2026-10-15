import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDeliveryQuote as quote, deliveryReceiptLines, estimateItem} from '../static/delivery-pricing.js';

test('free standard request starts at zero, with no tip or hidden purchase budget charge',()=>{
  assert.equal(quote().total,0);
  assert.equal(quote({budget:35}).total,0);
  assert.equal(quote({budget:35}).budget,35);
});
test('Ontario meal estimate includes tax and never adds budget twice',()=>{
  const q=quote({items:[{name:'Meal',group:'lunch',qty:2,basePrice:12.99}],budget:35,tip:2});
  assert.equal(q.itemsSubtotal,25.98);
  assert.equal(q.tax,3.38);
  assert.equal(q.total,31.36);
  assert.equal(q.overBudget,false);
});
test('basic grocery staples are zero-rated while custom taxable goods retain HST',()=>{
  const q=quote({service:{deliveryType:'groceries'},items:[{name:'Milk',basePrice:5.39},{name:'Detergent',basePrice:10}]});
  assert.equal(q.tax,1.3); assert.equal(q.total,16.69);
});
test('eligible prepared-food estimate uses Ontario point-of-sale rebate at the four dollar boundary',()=>{
  assert.equal(quote({items:[{group:'drinks',basePrice:4}]}).tax,.2);
  assert.equal(quote({items:[{group:'drinks',basePrice:4.01}]}).tax,.52);
});
test('distance, package weight, tier, speed and voluntary tip are separate and itemized',()=>{
  const q=quote({service:{deliveryType:'package'},distanceKm:10,parcelKg:7,partnerTier:{id:'pro'},speed:'express',tip:2});
  assert.equal(q.distanceFee,3.75);assert.equal(q.parcelFee,2);assert.equal(q.deliveryFee,11.75);
  assert.equal(q.tax,1.53);assert.equal(q.total,15.28);
});
test('discount cannot make an item or the receipt negative',()=>{
  const q=quote({items:[{qty:2,basePrice:4,priceAdjust:-50}],tip:-5,budget:-10,distanceKm:-20});
  assert.equal(q.total,0); assert.equal(q.items[0].lineTotal,0);assert.equal(q.items[0].priceAdjust,-4);
});
test('all receipt channels share itemized totals, budget semantics, and payment status',()=>{
  const request={id:'DLV-QA',items:[{name:'Coffee',group:'drinks',basePrice:2.49}],budget:10};
  const text=deliveryReceiptLines(request).join('\n');
  assert.match(text,/TOTAL ESTIMATE \(CAD\): CA\$2.61/);
  assert.match(text,/not proof of payment/i);assert.match(text,/limit only; not charged/);
});
test('item estimates distinguish drinks and family trays from single servings',()=>{
  assert.equal(estimateItem('Coffee','drinks'),2.49);
  assert.equal(estimateItem('Vanilla milkshake','drinks'),6.49);
  assert.equal(estimateItem('Family chicken tray','dinner'),49.99);
  assert.equal(estimateItem('Baked salmon plate','dinner'),21.99);
});
test('a confirmed receipt preserves the stored breakdown rather than recalculating a new quote',()=>{
  const request={items:[{name:'Lunch',group:'lunch',basePrice:12.99}],speed:'standard'};
  request.pricing=quote(request);
  request.speed='express';
  assert.match(deliveryReceiptLines(request).join('\n'),/TOTAL ESTIMATE \(CAD\): CA\$14.68/);
});
