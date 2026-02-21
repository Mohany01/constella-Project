import { Sidebar } from "@/components/ui/modern-side-bar";
import PlaceholderPage from "@/components/common/PlaceholderPage";

export default function SettingsPage() {
  return (
    <div className="modern-dashboard">
      <Sidebar>
        <PlaceholderPage
          title="Settings"
          subtitle="Configure workspace rules and notifications."
          hint="Connect integrations and fine-tune your workflow."
        />
      </Sidebar>
    </div>
  );
}
