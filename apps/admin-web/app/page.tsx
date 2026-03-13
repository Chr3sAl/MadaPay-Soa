'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';

type Tx = {
  id: string;
  status: string;
  transferId?: string | null;
  qrImagePath?: string | null;
  totalToPayMga?: string | number | null;
  destinationAmountCny?: string | number | null;
  failureReason?: string | null;
  createdAt: string;
  customer?: {
    messengerPsid?: string | null;
    fullName?: string | null;
    phone?: string | null;
  } | null;
};

type ApiListResponse = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: Tx[];
};

type AuditLogItem = {
  at: string;
  actor: string;
  action: 'RESOLVE_SUCCESS' | 'RESOLVE_FAILED';
  transactionId: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

type AuditLogResponse = {
  totalReturned: number;
  items: AuditLogItem[];
};

type ResolveBody = {
  transferIdVerified: boolean;
  amountVerified: boolean;
  payoutSent: boolean;
  result: 'SUCCESS' | 'FAILED';
  failureReason?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:3000';
const ADMIN_API_TOKEN = process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || '';
const ADMIN_USER = process.env.NEXT_PUBLIC_ADMIN_USER || 'local-admin';

const RESOLVABLE_STATUSES = new Set([
  'READY_FOR_HANDOFF',
  'AWAITING_TRANSFER_ID',
  'AWAITING_HUMAN',
  'IN_PROGRESS',
]);

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function getStatusPillStyle(status: string): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 700,
    display: 'inline-block',
  };

  if (status === 'SUCCESS') return { ...base, background: '#dcfce7', color: '#166534' };
  if (status === 'FAILED') return { ...base, background: '#fee2e2', color: '#991b1b' };
  if (RESOLVABLE_STATUSES.has(status)) {
    return { ...base, background: '#dbeafe', color: '#1d4ed8' };
  }

  return { ...base, background: '#e5e7eb', color: '#334155' };
}

function cardStyle(): CSSProperties {
  return {
    background: 'rgba(255,255,255,0.7)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.7)',
    borderRadius: 18,
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
  };
}

function metricCard(title: string, value: string | number, hint: string, accent: string): JSX.Element {
  return (
    <div
      style={{
        ...cardStyle(),
        padding: 16,
        minHeight: 110,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 95,
          height: 95,
          top: -24,
          right: -20,
          borderRadius: '50%',
          background: accent,
          filter: 'blur(18px)',
          opacity: 0.34,
        }}
      />
      <div style={{ fontSize: 12, color: '#64748b' }}>{title}</div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <strong style={{ fontSize: 32, lineHeight: 1 }}>{value}</strong>
        <span style={{ color: '#0891b2', fontWeight: 600, fontSize: 12 }}>{hint}</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [isCompact, setIsCompact] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Tx[]>([]);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    p.set('page', '1');
    p.set('limit', '50');
    return p.toString();
  }, [status]);

  const authHeaders = useMemo(
    () =>
      ADMIN_API_TOKEN
        ? {
            Authorization: `Bearer ${ADMIN_API_TOKEN}`,
          }
        : undefined,
    [],
  );

  const loadTransactions = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/transactions?${query}`, {
      cache: 'no-store',
      headers: authHeaders,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to load transactions (${res.status}): ${txt}`);
    }

    const data: ApiListResponse = await res.json();
    setItems(data.items || []);
  }, [authHeaders, query]);

  const loadAuditLogs = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/audit-logs?limit=20`, {
      cache: 'no-store',
      headers: authHeaders,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to load audit logs (${res.status}): ${txt}`);
    }

    const data: AuditLogResponse = await res.json();
    setLogs(data.items || []);
  }, [authHeaders]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadTransactions(), loadAuditLogs()]);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [loadAuditLogs, loadTransactions]);

  useEffect(() => {
    const syncLayout = () => setIsCompact(window.innerWidth < 1200);
    syncLayout();
    window.addEventListener('resize', syncLayout);
    return () => window.removeEventListener('resize', syncLayout);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function resolveTx(tx: Tx, result: 'SUCCESS' | 'FAILED') {
    if (!RESOLVABLE_STATUSES.has(tx.status)) return;

    const ok = window.confirm(`Mark transaction ${tx.id} as ${result}?`);
    if (!ok) return;

    setActionLoadingId(tx.id);
    setError(null);

    try {
      const body: ResolveBody = {
        transferIdVerified: result === 'SUCCESS',
        amountVerified: result === 'SUCCESS',
        payoutSent: result === 'SUCCESS',
        result,
      };

      if (result === 'FAILED') {
        const reason = window.prompt(
          'Failure reason (required for reject):',
          'Manual review failed',
        );

        if (!reason || !reason.trim()) {
          throw new Error('Failure reason is required for rejection.');
        }

        body.failureReason = reason.trim();
        body.transferIdVerified = false;
        body.amountVerified = false;
        body.payoutSent = false;
      }

      const res = await fetch(`${API_BASE}/admin/transactions/${tx.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeaders || {}),
          'x-admin-user': ADMIN_USER,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Resolve failed (${res.status}): ${txt}`);
      }

      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setActionLoadingId(null);
    }
  }

  const pendingCount = items.filter((tx) => RESOLVABLE_STATUSES.has(tx.status)).length;
  const successCount = items.filter((tx) => tx.status === 'SUCCESS').length;
  const failedCount = items.filter((tx) => tx.status === 'FAILED').length;

  const latest = items.slice(0, 8);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at 10% 10%, #dbeafe 0%, #c7d2fe 35%, #e2e8f0 100%)',
        padding: isCompact ? '12px 8px' : '18px 12px',
        fontFamily: 'Inter, Arial, sans-serif',
        color: '#0f172a',
      }}
    >
      <div style={{ ...cardStyle(), width: '100%', margin: 0, padding: isCompact ? 10 : 14 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isCompact ? '1fr' : '240px minmax(0,1fr)',
            gap: isCompact ? 10 : 14,
          }}
        >
          <aside style={{ ...cardStyle(), padding: 16, minHeight: isCompact ? 'auto' : 860 }}>
            <div style={{ fontWeight: 800, fontSize: 24, marginBottom: 18, color: '#1d4ed8' }}>MadaPay</div>
            {[
              'Dashboard',
              'Transactions',
              'Customers',
              'Audit Logs',
              'Reports',
              'Settings',
            ].map((item, idx) => (
              <div
                key={item}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  marginBottom: 6,
                  background: idx === 0 ? '#e0e7ff' : 'transparent',
                  color: idx === 0 ? '#1e3a8a' : '#475569',
                  fontWeight: idx === 0 ? 700 : 500,
                }}
              >
                {item}
              </div>
            ))}
          </aside>

          <section style={{ display: 'grid', gap: 14 }}>
            <header
              style={{
                ...cardStyle(),
                padding: 14,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>Hello, {ADMIN_USER}</div>
                <div style={{ color: '#64748b', fontSize: 13 }}>
                  Review transactions, resolve statuses and monitor audit logs
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  readOnly
                  value={status || 'ALL'}
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 999,
                    padding: '8px 14px',
                    fontSize: 12,
                    width: 130,
                    background: '#f8fafc',
                  }}
                />
                <button
                  onClick={load}
                  disabled={loading}
                  style={{
                    border: 0,
                    borderRadius: 999,
                    background: '#2563eb',
                    color: '#fff',
                    fontWeight: 700,
                    padding: '8px 14px',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </header>

            <section
              style={{
                display: 'grid',
                gap: 10,
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              }}
            >
              {metricCard('Total Loaded', items.length, '+ live', '#a5b4fc')}
              {metricCard('Needs Action', pendingCount, 'queue', '#93c5fd')}
              {metricCard('Success', successCount, 'approved', '#86efac')}
              {metricCard('Failed', failedCount, 'rejected', '#fca5a5')}
            </section>

            <section style={{ ...cardStyle(), padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <h2 style={{ margin: 0 }}>Transaction Summary</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 12, color: '#64748b' }}>Filter:</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px' }}
                  >
                    <option value="">ALL</option>
                    <option value="AWAITING_TRANSFER_ID">AWAITING_TRANSFER_ID</option>
                    <option value="READY_FOR_HANDOFF">READY_FOR_HANDOFF</option>
                    <option value="AWAITING_HUMAN">AWAITING_HUMAN</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                    <option value="SUCCESS">SUCCESS</option>
                    <option value="FAILED">FAILED</option>
                  </select>
                </div>
              </div>

              {error && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
                  {error}
                </div>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isCompact
                    ? 'minmax(0,1fr)'
                    : 'minmax(0,1fr) minmax(280px, 32%)',
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <div style={{ overflowX: 'auto' }}>
                  <table width="100%" cellPadding={10} style={{ borderCollapse: 'collapse', minWidth: 820 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #dbe1ea' }}>
                        <th>ID</th>
                        <th>Status</th>
                        <th>Transfer ID</th>
                        <th>Total MGA</th>
                        <th>Dest CNY</th>
                        <th>Created</th>
                        <th>QR</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.map((tx) => {
                        const canResolve = RESOLVABLE_STATUSES.has(tx.status);
                        const busy = actionLoadingId === tx.id;

                        return (
                          <tr key={tx.id} style={{ borderBottom: '1px solid #edf2f7' }}>
                            <td style={{ fontSize: 12 }}>{tx.id}</td>
                            <td>
                              <span style={getStatusPillStyle(tx.status)}>{tx.status}</span>
                            </td>
                            <td>{tx.transferId || '-'}</td>
                            <td>{String(tx.totalToPayMga ?? '-')}</td>
                            <td>{String(tx.destinationAmountCny ?? '-')}</td>
                            <td>{new Date(tx.createdAt).toLocaleString()}</td>
                            <td>
                              {tx.qrImagePath ? (
                                <button
                                  onClick={() => setPreviewUrl(tx.qrImagePath!)}
                                  style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '6px 10px' }}
                                >
                                  View
                                </button>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => resolveTx(tx, 'SUCCESS')}
                                disabled={!canResolve || busy}
                                style={{
                                  border: 0,
                                  borderRadius: 8,
                                  padding: '6px 10px',
                                  background: '#16a34a',
                                  color: '#fff',
                                  cursor: canResolve && !busy ? 'pointer' : 'not-allowed',
                                  opacity: canResolve && !busy ? 1 : 0.5,
                                }}
                              >
                                {busy ? 'Working...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => resolveTx(tx, 'FAILED')}
                                disabled={!canResolve || busy}
                                style={{
                                  border: 0,
                                  borderRadius: 8,
                                  padding: '6px 10px',
                                  background: '#dc2626',
                                  color: '#fff',
                                  cursor: canResolve && !busy ? 'pointer' : 'not-allowed',
                                  opacity: canResolve && !busy ? 1 : 0.5,
                                }}
                              >
                                {busy ? 'Working...' : 'Reject'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {latest.length === 0 && !loading && (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                            No transactions found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ ...cardStyle(), padding: 12 }}>
                  <h3 style={{ margin: '4px 0 12px' }}>Recent Audit</h3>
                  <div style={{ maxHeight: 345, overflowY: 'auto', display: 'grid', gap: 8 }}>
                    {logs.slice(0, 8).map((log, idx) => (
                      <div
                        key={`${log.transactionId}-${idx}`}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: 12,
                          padding: 10,
                          background: '#ffffffcc',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={getStatusPillStyle(log.action === 'RESOLVE_SUCCESS' ? 'SUCCESS' : 'FAILED')}>
                            {log.action}
                          </span>
                          <span style={{ fontSize: 11, color: '#64748b' }}>
                            {new Date(log.at).toLocaleTimeString()}
                          </span>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12 }}>
                          <div style={{ fontWeight: 700 }}>{log.actor}</div>
                          <div style={{ color: '#64748b' }}>{log.transactionId}</div>
                        </div>
                      </div>
                    ))}
                    {logs.length === 0 && (
                      <div style={{ color: '#64748b', fontSize: 13 }}>No audit logs yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section style={{ ...cardStyle(), padding: 14 }}>
              <h2 style={{ margin: '0 0 10px' }}>All Audit Logs</h2>
              <div style={{ overflowX: 'auto' }}>
                <table width="100%" cellPadding={10} style={{ borderCollapse: 'collapse', minWidth: 680 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#334155' }}>
                      <th>Time</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Transaction ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, idx) => (
                      <tr key={`${log.transactionId}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td>{new Date(log.at).toLocaleString()}</td>
                        <td>{log.actor}</td>
                        <td>
                          <span
                            style={getStatusPillStyle(
                              log.action === 'RESOLVE_SUCCESS' ? 'SUCCESS' : 'FAILED',
                            )}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td>{log.transactionId}</td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                          No audit logs yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </div>
      </div>

      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.78)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: 16,
              borderRadius: 12,
              maxWidth: '90vw',
              maxHeight: '90vh',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            }}
          >
            <div
              style={{
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <strong>QR Preview</strong>
              <button
                onClick={() => setPreviewUrl(null)}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '5px 10px' }}
              >
                Close
              </button>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="QR Preview" style={{ maxWidth: '80vw', maxHeight: '75vh' }} />
          </div>
        </div>
      )}
    </main>
  );
}