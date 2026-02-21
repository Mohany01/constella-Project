import { Sidebar } from "@/components/ui/modern-side-bar";
import PlaceholderPage from "@/components/common/PlaceholderPage";

export default function NotificationsPage() {
  return (
    <div className="modern-dashboard">
      <Sidebar>
        <PlaceholderPage
          title="Notifications"
          subtitle="Stay on top of project updates and team activity."
          hint="You'll see alerts, mentions, and system updates here."
        />
      </Sidebar>
    </div>
  );
}
