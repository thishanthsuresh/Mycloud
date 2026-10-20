import ModulePage from "@/components/ui/ModulePage";
// import YourComponent from "@/components/features/professional/YourComponent";

export default function Page() {
  // Attach your screens: keys must match the tabs in lib/modules.ts
  // e.g. sections={{ "Requests": <YourComponent /> }}
  return <ModulePage slug="professional" />;
}
