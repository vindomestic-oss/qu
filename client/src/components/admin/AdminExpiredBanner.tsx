import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ADMIN_EXPIRED_EVENT, adminLoginUrl } from '../../api/client';

/** Shown on /admin pages when a background request found the admin token expired. */
export function AdminExpiredBanner() {
  const [expired, setExpired] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(ADMIN_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(ADMIN_EXPIRED_EVENT, onExpired);
  }, []);

  if (!expired || !pathname.startsWith('/admin') || pathname.startsWith('/admin/login')) return null;
  return (
    <div
      role="alert"
      style={{
        maxWidth: 720,
        margin: '8px auto',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--danger)',
        background: 'var(--surface-alt)',
        color: 'var(--text)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <span>Your session has expired. Copy anything you were typing, then log in again.</span>
      <button type="button" onClick={() => location.assign(adminLoginUrl())}>
        Log in again
      </button>
    </div>
  );
}
