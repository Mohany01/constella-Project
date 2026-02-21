import { Sidebar } from "@/components/ui/modern-side-bar";
import PlaceholderPage from "@/components/common/PlaceholderPage";

export default function ProfilePage() {
  return (
    <div className="modern-dashboard">
      <Sidebar>
        <PlaceholderPage
          title="Profile"
          subtitle="Manage your personal information and preferences."
          hint="Profile details and account settings will live here."
        />
      </Sidebar>
    </div>
  );
}
