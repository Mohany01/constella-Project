import { Sidebar } from "@/components/ui/modern-side-bar";
import PlaceholderPage from "@/components/common/PlaceholderPage";

export default function HelpPage() {
  return (
    <div className="modern-dashboard">
      <Sidebar>
        <PlaceholderPage
          title="Help & Support"
          subtitle="Find answers, tutorials, and get in touch."
          hint="We'll add FAQs, guides, and support resources here."
        />
      </Sidebar>
    </div>
  );
}
