import Logo from "../Logo";

export default function DashboardBrand() {
  return (
    <div className="dashboard-brand">
      <Logo variant="white" size={24} showName />
      <span className="dashboard-brand-divider" aria-hidden="true" />
    </div>
  );
}
