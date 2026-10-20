import ModulePage from "@/components/ui/ModulePage";
import FilesTab from "@/components/features/chatcloud/FilesTab";
import RenewalsTab from "@/components/features/chatcloud/RenewalsTab";

export default function Page() {
  return (
    <ModulePage
      slug="chatcloud"
      sections={{
        Files: <FilesTab />,
        Renewals: <RenewalsTab />,
      }}
    />
  );
}
