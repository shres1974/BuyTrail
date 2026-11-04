import { getSettings, listExports } from "@buytrail/services";
import { CATEGORIES } from "@buytrail/domain";
import { pageActor } from "@/server/guard";
import { services } from "@/server/services";
import { Card, PageTitle } from "@/components/ui";
import { SettingsForm } from "@/components/SettingsForm";
import { AccountDataPanel } from "@/components/AccountDataPanel";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const actor = await pageActor("/settings");
  const s = services();
  const [settings, exports] = await Promise.all([getSettings(s.db, actor), listExports(s.db, s.clock.now(), actor)]);
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle>Settings</PageTitle>
      <Card>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <SettingsForm settings={settings} categories={Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label }))} />
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Your data</h2>
        <AccountDataPanel email={settings.email} exports={exports} />
      </Card>
    </div>
  );
}
