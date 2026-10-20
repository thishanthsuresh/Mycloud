import ModulePage from "@/components/ui/ModulePage";
import DevicesPanel from "@/components/features/security/DevicesPanel";
import EncryptedShare from "@/components/features/security/EncryptedShare";
import PersonalVault from "@/components/features/security/PersonalVault";

export default function Page() {
  return (
    <ModulePage
      slug="security"
      sections={{
        Devices: <DevicesPanel />,
        "Personal Vault": <PersonalVault />,
        "Encrypted Share": <EncryptedShare />,
      }}
    />
  );
}
