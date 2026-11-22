const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../lib/pricing');
const invoice = require('../lib/invoice');
const reports = require('../lib/reports');

function makeOrder(items, coupon) {
  const billed = pricing.computeTotals(items, coupon || '');

  return {
    id: 9001,
    date: '22/11/2026',
    customer: 'Characterization Customer',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  };
}

test('CURRENT BEHAVIOUR: order pricing uses the HSN slab and taxes the discounted value', () => {
  const items = [
    {
      id: 1,
      sku: 'GRN-001',
      name: 'Rice',
      hsn: '1006',
      price: 100,
      qty: 1
    }
  ];

  const totals = pricing.computeTotals(items, '');

  assert.deepEqual(
    {
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxable: totals.taxable,
      tax: totals.tax,
      cgst: totals.cgst,
      sgst: totals.sgst,
      total: totals.total
    },
    {
      subtotal: 100,
      discount: 0,
      taxable: 100,
      tax: 5,
      cgst: 2.5,
      sgst: 2.5,
      total: 105
    }
  );
  assert.equal(totals.lines[0].gstPercent, 5);
  assert.equal(totals.lines[0].tax, 5);
});

test('invoice matches the GST breakdown billed for an HSN-priced order', () => {
  const order = makeOrder([
    {
      id: 1,
      sku: 'GRN-001',
      name: 'Rice',
      hsn: '1006',
      price: 100,
      qty: 1
    }
  ]);

  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 5);
  assert.equal(order.total, 105);
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 5);
  assert.equal(figures.tax, order.tax);
  assert.equal(figures.cgst, 2.5);
  assert.equal(figures.sgst, 2.5);
  assert.equal(figures.total, order.total);
});

test('invoice matches the billed capped coupon discount and post-discount GST', () => {
  const order = makeOrder([
    {
      id: 1,
      sku: 'GRN-001',
      name: 'Rice',
      hsn: '1006',
      price: 2000,
      qty: 1
    }
  ], 'SAVE10');

  const figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.discount, 150);
  assert.equal(order.tax, 92.5);
  assert.equal(order.total, 1942.5);
  assert.equal(figures.discount, order.discount);
  assert.equal(figures.tax, order.tax);
  assert.equal(figures.total, order.total);
});

test('invoice matches the ticket examples for mixed GST slabs and coupon orders', () => {
  const ticketOrders = [
    {
      id: 1002,
      coupon: 'SAVE10',
      expected: { subtotal: 1020, discount: 102, tax: 45.9, total: 963.9 },
      items: [
        { id: 1, sku: 'GRN-001', name: 'Rice', hsn: '1006', price: 640, qty: 1 },
        { id: 4, sku: 'OIL-001', name: 'Sunflower Oil', hsn: '1512', price: 190, qty: 2 }
      ]
    },
    {
      id: 1004,
      coupon: 'SAVE10',
      expected: { subtotal: 2240, discount: 150, tax: 104.5, total: 2194.5 },
      items: [
        { id: 5, sku: 'OIL-002', name: 'Groundnut Oil', hsn: '1508', price: 1120, qty: 2 }
      ]
    },
    {
      id: 1007,
      coupon: '',
      expected: { subtotal: 1280, discount: 0, tax: 127, total: 1407 },
      items: [
        { id: 6, sku: 'DRY-001', name: 'Ghee', hsn: '0405', price: 450, qty: 2 },
        { id: 4, sku: 'OIL-001', name: 'Sunflower Oil', hsn: '1512', price: 190, qty: 2 }
      ]
    },
    {
      id: 1008,
      coupon: '',
      expected: { subtotal: 500, discount: 0, tax: 90, total: 590 },
      items: [
        { id: 8, sku: 'BEV-001', name: 'Tea', hsn: '0902', price: 140, qty: 1 },
        { id: 12, sku: 'BEV-003', name: 'Sherbet', hsn: '2106', price: 180, qty: 2 }
      ]
    }
  ];

  for (const example of ticketOrders) {
    const order = makeOrder(example.items, example.coupon);
    order.id = example.id;
    const figures = invoice.computeInvoiceFigures(order);

    assert.deepEqual(
      {
        subtotal: figures.subtotal,
        discount: figures.discount,
        tax: figures.tax,
        total: figures.total
      },
      example.expected,
      `order ${example.id} invoice should match billed figures`
    );
    assert.equal(figures.total, order.total, `order ${example.id} invoice total`);
  }
});

test('GST reconciliation reports matching invoice and billed totals', () => {
  const order = makeOrder([
    {
      id: 1,
      sku: 'GRN-001',
      name: 'Rice',
      hsn: '1006',
      price: 100,
      qty: 1
    }
  ]);

  const reconciliation = reports.getGstReconciliation({ orders: [order] });

  assert.equal(reconciliation.totalChecked, 1);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.equal(reconciliation.rows[0].ledgerTax, 5);
  assert.equal(reconciliation.rows[0].invoiceTax, 5);
  assert.equal(reconciliation.rows[0].ledgerTotal, 105);
  assert.equal(reconciliation.rows[0].invoiceTotal, 105);
  assert.equal(reconciliation.rows[0].delta, 0);
  assert.equal(reconciliation.rows[0].matched, true);
});
