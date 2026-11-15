'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Item = Record<string, any>;
type Receipt = { variantId: string; quantity: number; damaged: number };
type PoLine = { variantId: string; quantity: number; unitCost: number };

const API = '/api/v1';

async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(API + path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const raw = await response.text();
  let result: any;

  try {
    result = raw ? JSON.parse(raw) : null;
  } catch {
    result = raw;
  }

  if (!response.ok) {
    const message = Array.isArray(result?.message)
      ? result.message.join(', ')
      : result?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return result;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
};

const buttonStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 6,
  border: '1px solid #94a3b8',
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
};

const panelStyle: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};

function variantsFromProducts(products: Item[]): Item[] {
  return products.flatMap(product =>
    (product.variants || []).map((variant: Item) => ({
      ...variant,
      productTitle: product.title,
    })),
  );
}

export default function PurchasingManagement() {
  const [suppliers, setSuppliers] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');

  const [supplierForm, setSupplierForm] = useState({
    id: '',
    code: '',
    name: '',
    phone: '',
    email: '',
    active: true,
  });

  const [po, setPo] = useState({
    supplierId: '',
    warehouseId: '',
    reference: '',
  });

  const [lines, setLines] = useState<PoLine[]>([
    { variantId: '', quantity: 1, unitCost: 0 },
  ]);

  const [receipts, setReceipts] = useState<Record<string, Receipt[]>>({});

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      request('/purchasing/suppliers'),
      request('/purchasing/orders'),
      request('/inventory/locations'),
      request('/catalog/products'),
    ]);

    const names = ['suppliers', 'orders', 'locations', 'products'];
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${names[index]}: ${String(result.reason?.message || result.reason)}`]
        : [],
    );

    const values = results.map(result =>
      result.status === 'fulfilled' ? result.value : [],
    );

    const asArray = (value: any): Item[] =>
      Array.isArray(value)
        ? value
        : Array.isArray(value?.items)
          ? value.items
          : Array.isArray(value?.data)
            ? value.data
            : Array.isArray(value?.products)
              ? value.products
              : [];

    setSuppliers(asArray(values[0]));
    setOrders(asArray(values[1]));
    setWarehouses(asArray(values[2]).filter(x => x.type === 'WAREHOUSE'));
    setVariants(variantsFromProducts(asArray(values[3])));

    setError(failures.join(' | '));
  }, []);

  useEffect(() => {
    load().catch(e => setError(e.message));
  }, [load]);

  async function execute(action: () => Promise<any>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await action();
      await load();
      setMessage(success);
      return true;
    } catch (e: any) {
      setError(e.message || 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const activeSuppliers = suppliers.filter(s => s.active);

  const filteredOrders = useMemo(() => orders.filter(o => {
    const matchesStatus = status === 'ALL' || o.status === status;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      String(o.reference || '').toLowerCase().includes(query) ||
      String(o.supplier?.name || '').toLowerCase().includes(query);

    return matchesStatus && matchesSearch;
  }), [orders, search, status]);

  const variantLabel = (id: string) => {
    const v = variants.find(x => x.id === id);
    return v
      ? `${v.productTitle || ''} | ${v.sku || ''} | ${v.size || ''} ${v.color || ''}`
      : id;
  };

  const updateLine = (index: number, change: Partial<PoLine>) => {
    setLines(current => current.map((line, i) =>
      i === index ? { ...line, ...change } : line,
    ));
  };

  const saveSupplier = async () => {
    if (!supplierForm.code.trim() || !supplierForm.name.trim()) {
      setError('Supplier code and name are required.');
      return;
    }

    const body = {
      code: supplierForm.code.trim(),
      name: supplierForm.name.trim(),
      phone: supplierForm.phone.trim(),
      ...(supplierForm.email.trim() ? { email: supplierForm.email.trim() } : {}),
      ...(supplierForm.id ? { active: supplierForm.active } : {}),
    };

    const saved = await execute(
      () => request(
        supplierForm.id
          ? `/purchasing/suppliers/${supplierForm.id}`
          : '/purchasing/suppliers',
        supplierForm.id ? 'PATCH' : 'POST',
        body,
      ),
      'Supplier saved successfully.',
    );

    if (saved) {
      setSupplierForm({
        id: '', code: '', name: '', phone: '', email: '', active: true,
      });
    }
  };

  const createOrder = async () => {
    if (!po.supplierId || !po.warehouseId || po.reference.trim().length < 5) {
      setError('Select a supplier and warehouse and enter a reference of at least 5 characters.');
      return;
    }

    if (
      lines.length === 0 ||
      lines.some(l =>
        !l.variantId ||
        !Number.isInteger(l.quantity) ||
        l.quantity < 1 ||
        !Number.isFinite(l.unitCost) ||
        l.unitCost < 0
      )
    ) {
      setError('Each PO line needs a variant, positive whole-number quantity, and valid unit cost.');
      return;
    }

    if (new Set(lines.map(l => l.variantId)).size !== lines.length) {
      setError('A variant cannot appear twice on the same purchase order.');
      return;
    }

    const saved = await execute(
      () => request('/purchasing/orders', 'POST', {
        ...po,
        reference: po.reference.trim(),
        lines,
      }),
      'Purchase order submitted.',
    );

    if (saved) {
      setPo({ supplierId: '', warehouseId: '', reference: '' });
      setLines([{ variantId: '', quantity: 1, unitCost: 0 }]);
    }
  };

  const receiptLines = (order: Item): Receipt[] => {
    return receipts[order.id] ||
      (order.lines || []).map((l: Item) => ({
        variantId: l.variantId,
        quantity: 0,
        damaged: 0,
      }));
  };

  const updateReceipt = (
    order: Item,
    variantId: string,
    change: Partial<Receipt>,
  ) => {
    setReceipts(current => ({
      ...current,
      [order.id]: receiptLines(order).map(line =>
        line.variantId === variantId ? { ...line, ...change } : line,
      ),
    }));
  };

  const receiveOrder = async (order: Item) => {
    const selected = receiptLines(order);
    const orderLines: Item[] = order.lines || [];

    const invalid = selected.some(line => {
      const original = orderLines.find(l => l.variantId === line.variantId);
      const remaining = original
        ? original.orderedQty - original.receivedQty
        : 0;

      return !Number.isInteger(line.quantity) ||
        !Number.isInteger(line.damaged) ||
        line.quantity < 0 ||
        line.damaged < 0 ||
        line.quantity + line.damaged > remaining;
    });

    if (invalid) {
      setError('Receipt quantities must be nonnegative whole numbers and cannot exceed remaining quantities.');
      return;
    }

    if (!selected.some(l => l.quantity + l.damaged > 0)) {
      setError('Enter at least one received or damaged unit.');
      return;
    }

    if (!window.confirm(`Post this receipt for ${order.reference}? Warehouse stock will be updated.`)) {
      return;
    }

    const saved = await execute(
      () => request(`/purchasing/orders/${order.id}/receive`, 'POST', {
        lines: selected.filter(l => l.quantity + l.damaged > 0),
      }),
      'Goods receipt posted to warehouse inventory.',
    );

    if (saved) {
      setReceipts(current => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
    }
  };

  const cancelOrder = async (order: Item) => {
    if (!window.confirm(`Cancel purchase order ${order.reference}?`)) return;

    await execute(
      () => request(`/purchasing/orders/${order.id}/cancel`, 'POST'),
      'Purchase order cancelled.',
    );
  };

  return (
    <section style={{ display: 'grid', gap: 20 }}>
      <header>
        <h2>Purchasing & Supplier Management</h2>
        <p>Manage suppliers, purchase orders, and central warehouse receiving.</p>
      </header>

      {error && (
        <div role="alert" style={{ ...panelStyle, borderColor: '#dc2626' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {message && (
        <div role="status" style={{ ...panelStyle, borderColor: '#16a34a' }}>
          {message}
        </div>
      )}

      <div style={panelStyle}>
        <h3>{supplierForm.id ? 'Edit supplier' : 'Add supplier'}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <input aria-label="Supplier code" style={inputStyle}
            placeholder="Supplier code"
            value={supplierForm.code}
            onChange={e => setSupplierForm(s => ({ ...s, code: e.target.value }))} />

          <input aria-label="Supplier name" style={inputStyle}
            placeholder="Supplier name"
            value={supplierForm.name}
            onChange={e => setSupplierForm(s => ({ ...s, name: e.target.value }))} />

          <input aria-label="Supplier phone" style={inputStyle}
            placeholder="Phone"
            value={supplierForm.phone}
            onChange={e => setSupplierForm(s => ({ ...s, phone: e.target.value }))} />

          <input aria-label="Supplier email" style={inputStyle}
            placeholder="Email" type="email"
            value={supplierForm.email}
            onChange={e => setSupplierForm(s => ({ ...s, email: e.target.value }))} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {supplierForm.id && (
            <label>
              <input type="checkbox" checked={supplierForm.active}
                onChange={e => setSupplierForm(s => ({ ...s, active: e.target.checked }))} />
              {' '}Active
            </label>
          )}

          <button style={buttonStyle} disabled={busy} onClick={saveSupplier}>
            {supplierForm.id ? 'Update supplier' : 'Create supplier'}
          </button>

          {supplierForm.id && (
            <button style={buttonStyle} onClick={() => setSupplierForm({
              id: '', code: '', name: '', phone: '', email: '', active: true,
            })}>
              Cancel edit
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Phone</th>
                <th>Email</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id}>
                  <td>{s.code}</td><td>{s.name}</td>
                  <td>{s.phone || '-'}</td><td>{s.email || '-'}</td>
                  <td>{s.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button style={buttonStyle} onClick={() => setSupplierForm({
                      id: s.id,
                      code: s.code || '',
                      name: s.name || '',
                      phone: s.phone || '',
                      email: s.email || '',
                      active: Boolean(s.active),
                    })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={panelStyle}>
        <h3>Create purchase order</h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
          <select aria-label="Purchase order supplier" style={inputStyle}
            value={po.supplierId}
            onChange={e => setPo(p => ({ ...p, supplierId: e.target.value }))}>
            <option value="">Select supplier</option>
            {activeSuppliers.map(s =>
              <option key={s.id} value={s.id}>{s.name}</option>
            )}
          </select>

          <select aria-label="Receiving warehouse" style={inputStyle}
            value={po.warehouseId}
            onChange={e => setPo(p => ({ ...p, warehouseId: e.target.value }))}>
            <option value="">Select warehouse</option>
            {warehouses.map(w =>
              <option key={w.id} value={w.id}>{w.name || w.code}</option>
            )}
          </select>

          <input aria-label="Purchase order reference" style={inputStyle}
            placeholder="PO reference (e.g. PO-2026-001)"
            value={po.reference}
            onChange={e => setPo(p => ({ ...p, reference: e.target.value }))} />
        </div>

        <h4>Order lines</h4>

        {lines.map((line, index) => (
          <div key={index} style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px,3fr) minmax(80px,1fr) minmax(100px,1fr) auto',
            gap: 8,
            marginBottom: 10,
          }}>
            <select aria-label={`Variant line ${index + 1}`} style={inputStyle}
              value={line.variantId}
              onChange={e => updateLine(index, { variantId: e.target.value })}>
              <option value="">Select footwear variant</option>
              {variants.map(v =>
                <option key={v.id} value={v.id}>
                  {variantLabel(v.id)}
                </option>
              )}
            </select>

            <input aria-label={`Quantity line ${index + 1}`} style={inputStyle}
              type="number" min="1" step="1"
              value={line.quantity}
              onChange={e => updateLine(index, { quantity: Number(e.target.value) })} />

            <input aria-label={`Unit cost line ${index + 1}`} style={inputStyle}
              type="number" min="0" step="0.01"
              value={line.unitCost}
              onChange={e => updateLine(index, { unitCost: Number(e.target.value) })} />

            <button style={buttonStyle} disabled={lines.length === 1}
              onClick={() => setLines(current => current.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button style={buttonStyle} onClick={() =>
            setLines(current => [...current, { variantId: '', quantity: 1, unitCost: 0 }])
          }>
            + Add line
          </button>

          <button style={buttonStyle} disabled={busy} onClick={createOrder}>
            Submit purchase order
          </button>
        </div>

        <p>
          Total estimated cost: {lines.reduce(
            (sum, line) => sum + line.quantity * line.unitCost, 0,
          ).toFixed(2)}
        </p>
      </div>

      <div style={panelStyle}>
        <h3>Purchase orders & receiving</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <input aria-label="Search purchase orders" style={{ ...inputStyle, maxWidth: 320 }}
            placeholder="Search reference or supplier"
            value={search}
            onChange={e => setSearch(e.target.value)} />

          <select aria-label="Purchase order status" style={{ ...inputStyle, maxWidth: 180 }}
            value={status}
            onChange={e => setStatus(e.target.value)}>
            {['ALL', 'DRAFT', 'SUBMITTED', 'RECEIVED', 'CANCELLED'].map(s =>
              <option key={s} value={s}>{s}</option>
            )}
          </select>

          <button style={buttonStyle} disabled={busy}
            onClick={() => load().catch(e => setError(e.message))}>
            Refresh
          </button>
        </div>

        {filteredOrders.length === 0 && <p>No purchase orders found.</p>}

        {filteredOrders.map(order => {
          const received = (order.lines || []).some((l: Item) => l.receivedQty > 0);
          const canCancel =
            ['SUBMITTED', 'DRAFT'].includes(order.status) && !received;

          return (
            <div key={order.id} style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{order.reference}</strong>
                  <div>{order.supplier?.name || 'Supplier unavailable'}</div>
                  <small>Status: {order.status}</small>
                </div>

                {canCancel && (
                  <button style={buttonStyle} disabled={busy}
                    onClick={() => cancelOrder(order)}>
                    Cancel PO
                  </button>
                )}
              </div>

              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', textAlign: 'left' }}>
                  <thead>
                    <tr>
                      <th>Footwear variant</th>
                      <th>Ordered</th>
                      <th>Received</th>
                      <th>Remaining</th>
                      {order.status === 'SUBMITTED' && <>
                        <th>Good qty</th><th>Damaged qty</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {(order.lines || []).map((line: Item) => {
                      const remaining = line.orderedQty - line.receivedQty;
                      const receipt = receiptLines(order).find(
                        x => x.variantId === line.variantId,
                      );

                      return (
                        <tr key={line.id}>
                          <td>{variantLabel(line.variantId)}</td>
                          <td>{line.orderedQty}</td>
                          <td>{line.receivedQty}</td>
                          <td>{remaining}</td>

                          {order.status === 'SUBMITTED' && <>
                            <td>
                              <input style={{ ...inputStyle, width: 90 }}
                                aria-label={`Good received ${line.variantId}`}
                                type="number" min="0" max={remaining} step="1"
                                value={receipt?.quantity ?? 0}
                                onChange={e => updateReceipt(order, line.variantId, {
                                  quantity: Number(e.target.value),
                                })} />
                            </td>
                            <td>
                              <input style={{ ...inputStyle, width: 90 }}
                                aria-label={`Damaged received ${line.variantId}`}
                                type="number" min="0" max={remaining} step="1"
                                value={receipt?.damaged ?? 0}
                                onChange={e => updateReceipt(order, line.variantId, {
                                  damaged: Number(e.target.value),
                                })} />
                            </td>
                          </>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {order.status === 'SUBMITTED' && (
                <button style={{ ...buttonStyle, marginTop: 12 }}
                  disabled={busy}
                  onClick={() => receiveOrder(order)}>
                  Post goods receipt
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}