import ModulePage from "@/components/ui/ModulePage";
import FinancialOverview from "@/components/features/financial/FinancialOverview";
import BillsPanel from "@/components/features/financial/BillsPanel";
import GoalsPanel from "@/components/features/financial/GoalsPanel";

export default function Page() {
  return (
    <ModulePage
      slug="financial"
      sections={{
        Overview: <FinancialOverview />,
        Bills: <BillsPanel />,
        Goals: <GoalsPanel />,
      }}
    />
  );
}
