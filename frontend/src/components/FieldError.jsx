/** Purpose: the message under one invalid field. Renders nothing when there is no message. */
export default function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {children}
    </p>
  );
}
