// Editable planning estimates in CAD, not live retailer/carrier quotes or payment capture.
export const PRICING_VERSION = 'ontario-estimate-v1';
export const GROCERY_ESTIMATES = Object.freeze({Milk:5.39,Eggs:4.49,Bread:2.99,Bananas:1.65,'Chicken breast':13.99,'Ground turkey':6.49,Rice:3.49,Pasta:2.49,'Olive oil':8.99,Spinach:3.49,Tomatoes:4.49,'Cheddar cheese':5.99});
export const GROCERY_UNITS = Object.freeze({Milk:'2 L',Eggs:'12 large',Bread:'675 g',Bananas:'1 kg','Chicken breast':'1 kg','Ground turkey':'454 g',Rice:'900 g',Pasta:'900 g','Olive oil':'500 mL',Spinach:'142 g',Tomatoes:'1 kg','Cheddar cheese':'400 g'});
export const DELIVERY_RATES = Object.freeze({baseFee:0,expressFee:3,priorityFee:6,addonFee:0});
const cents = value => Math.max(0, Math.min(100000000,Math.round((Number.isFinite(Number(value)) ? Number(value) : 0)*100)));
const dollars = value => value/100;
export const money = value => `CA$${(Number(value)||0).toFixed(2)}`;
export function estimateItem(name='',group='') {
  if (Object.hasOwn(GROCERY_ESTIMATES,name)) return GROCERY_ESTIMATES[name];
  const n=String(name).toLowerCase();
  if (/tray|family size/.test(n)) return 49.99;
  if (/salmon/.test(n)) return 21.99;
  if (/beef/.test(n)) return 18.99;
  if (/milkshake/.test(n)) return 6.49;
  if (/smoothie/.test(n)) return 6.99;
  if (/latte|cappuccino/.test(n)) return 4.75;
  if (/slurp|slush/.test(n)) return 3.49;
  if (/coffee|tea\b/.test(n)) return 2.49;
  if (/coca-cola|soda|pepsi|sprite/.test(n)) return 2.25;
  if (/pringles|doritos|cheetos|lay's/.test(n)) return 3.49;
  return ({breakfast:8.99,lunch:12.99,dinner:16.99,dessert:5.49,pringles:3.49,drinks:3.49})[group] ?? 0;
}
export function calculateDeliveryQuote(request={}) {
  const items=(Array.isArray(request.items)?request.items:[]).filter(item=>item && typeof item==='object').map(item=>{
    const qty=Math.min(1000,Math.max(1,Math.floor(Number(item.qty)||1)));
    const base=cents(item.basePrice);
    const adjustment=Number.isFinite(Number(item.priceAdjust))?Math.round(Number(item.priceAdjust)*100):0;
    const unit=Math.max(0,base+adjustment);
    return {...item,qty,basePrice:dollars(base),priceAdjust:dollars(unit-base),lineTotal:dollars(unit*qty)};
  });
  const prepared=new Set(['breakfast','lunch','dinner','dessert','drinks']);
  const isBasic=item=>request.service?.deliveryType==='groceries'&&Object.hasOwn(GROCERY_ESTIMATES,item.name);
  const isPrepared=item=>!isBasic(item)&&prepared.has(item.group);
  const preparedCents=items.filter(isPrepared).reduce((sum,item)=>sum+cents(item.lineTotal),0);
  let itemTax=0;
  for(const item of items) itemTax+=isBasic(item)?0:Math.round(cents(item.lineTotal)*(isPrepared(item)&&preparedCents<=400?.05:.13));
  const tierFee=({core:0,pro:300,elite:600})[request.partnerTier?.id]||0;
  const speedFee=({standard:0,express:300,priority:600})[request.speed]||0;
  const distance=Math.min(1000,Math.max(0,Number(request.distanceKm)||0));
  const weight=Math.min(1000,Math.max(0,Number(request.parcelKg)||0));
  const distanceFee=Math.round(Math.max(0,distance-5)*75);
  const parcelFee=request.service?.deliveryType==='package'?Math.round(Math.max(0,weight-5)*100):0;
  const delivery=tierFee+speedFee+distanceFee+parcelFee;
  const serviceTax=Math.round(delivery*.13);
  const subtotal=items.reduce((sum,item)=>sum+cents(item.lineTotal),0);
  const tip=cents(request.tip);
  const budget=cents(request.budget); // spending limit, never a second purchase charge
  return {version:PRICING_VERSION,currency:'CAD',estimate:true,paymentStatus:'not-collected',items,
    itemsSubtotal:dollars(items.reduce((sum,item)=>sum+cents(item.basePrice)*item.qty,0)),
    adjustments:dollars(subtotal-items.reduce((sum,item)=>sum+cents(item.basePrice)*item.qty,0)),
    discountedItemsSubtotal:dollars(subtotal),baseFee:0,tierFee:dollars(tierFee),speedFee:dollars(speedFee),addonFee:0,
    distanceFee:dollars(distanceFee),parcelFee:dollars(parcelFee),deliveryFee:dollars(delivery),
    itemTax:dollars(itemTax),serviceTax:dollars(serviceTax),tax:dollars(itemTax+serviceTax),tip:dollars(tip),budget:dollars(budget),
    total:dollars(subtotal+delivery+itemTax+serviceTax+tip),overBudget:budget>0&&subtotal>budget};
}
export function deliveryReceiptLines(request={}) {
  const q=request.pricing?.version && Array.isArray(request.pricing.items) ? request.pricing : calculateDeliveryQuote(request);
  return ['CHAINeS Concierge Delivery — CAD estimate / request confirmation',
    `Receipt ID: ${request.id||'PREVIEW'}`,`Created: ${request.createdAt||''}`,`Customer: ${request.customer?.name||''}`,
    `Phone: ${request.customer?.phone||''}`,`Pickup: ${request.route?.pickup||''}`,`Dropoff: ${request.route?.dropoff||''}`,
    `Service: ${request.service?.name||'Custom request'} (${request.service?.deliveryType||'meal'})`,
    `Tier: ${request.partnerTier?.name||'Core Delivery'}; speed: ${request.speed||'standard'}`,
    ...q.items.map(item=>`${item.qty} x ${item.name} @ ${money(item.basePrice+item.priceAdjust)} = ${money(item.lineTotal)}`),
    `Items subtotal: ${money(q.itemsSubtotal)}`,`Item adjustments: ${money(q.adjustments)}`,
    `Standard service: ${money(q.baseFee)}`,`Tier upgrade: ${money(q.tierFee)}`,`Speed upgrade: ${money(q.speedFee)}`,
    `Distance (${Number(request.distanceKm)||0} km): ${money(q.distanceFee)}`,`Parcel weight surcharge: ${money(q.parcelFee)}`,
    `Item tax estimate: ${money(q.itemTax)}`,`Delivery HST (13%): ${money(q.serviceTax)}`,
    `Voluntary tip: ${money(q.tip)}`,`TOTAL ESTIMATE (CAD): ${money(q.total)}`,
    `Purchase budget (limit only; not charged): ${money(q.budget)}`,
    'Payment: not collected. Not proof of payment. Merchant prices, tax eligibility and carrier quotes require confirmation.',
    `Receipt comment: ${request.receiptComment||'None'}`,`Notes: ${request.notes||'None'}`];
}
