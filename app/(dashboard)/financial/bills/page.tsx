import FinancialOverview from "@/components/features/financial/FinancialOverview";
import BillsPanel from "@/components/features/financial/BillsPanel";
import GoalsPanel from "@/components/features/financial/GoalsPanel";
import ModulePage from "@/components/ui/ModulePage";

export default function BillsPage() {
  return (
    <ModulePage
      slug="financial"
      initialTab="Bills"
      sections={{
        Overview: <FinancialOverview />,
        Bills: <BillsPanel />,
        Goals: <GoalsPanel />,
      }}
    />
  );
}
