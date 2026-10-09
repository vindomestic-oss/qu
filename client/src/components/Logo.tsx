// width/height reserve the box before logo.png (513×190) arrives, so the dark-theme plate does not
// flash as a thin pill on a slow connection.
export function Logo() {
  return <img src="/logo.png" alt="EJKA" className="logo" width={162} height={60} />;
}
