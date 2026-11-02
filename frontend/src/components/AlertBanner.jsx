const TONE_CLASS = {
  error: 'alert',
  success: 'alert success',
  warning: 'alert warning',
  info: 'alert info',
};

/** Purpose: a page-level message. error and warning interrupt; success and info do not. */
export default function AlertBanner({ tone = 'error', role, children }) {
  if (!children) return null;
  const alertRole = role || (tone === 'success' || tone === 'info' ? 'status' : 'alert');
  return (
    <div className={TONE_CLASS[tone] || TONE_CLASS.error} role={alertRole}>
      {children}
    </div>
  );
}
