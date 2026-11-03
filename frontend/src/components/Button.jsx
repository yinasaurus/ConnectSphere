import { Link } from 'react-router-dom';

const VARIANT_CLASS = {
  primary: 'btn',
  secondary: 'btn secondary',
  ghost: 'btn ghost',
  danger: 'btn danger',
};

/**
 * Purpose: one button style for the app. `to` renders a link with the same look.
 * Variants: primary, secondary, ghost, danger.
 */
export default function Button({
  variant = 'primary',
  type = 'button',
  to,
  className = '',
  children,
  ...props
}) {
  const classes = [VARIANT_CLASS[variant] || VARIANT_CLASS.primary, className].filter(Boolean).join(' ');
  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
