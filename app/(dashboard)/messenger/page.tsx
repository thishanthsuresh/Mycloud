import Messenger from "@/components/features/messenger/Messenger";
import ModulePage from "@/components/ui/ModulePage";

export default function Page() {
  return <ModulePage slug="messenger" sections={{ Conversations: <Messenger /> }} />;
}
