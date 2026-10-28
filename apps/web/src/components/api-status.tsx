import { Badge } from "@/components/ui/badge";
import { getHealth } from "@/lib/api";

export async function ApiStatus() {
  const health = await getHealth();

  if (!health) {
    return <Badge variant="destructive">API unreachable</Badge>;
  }

  return (
    <Badge variant="secondary">
      API {health.status} · v{health.version}
    </Badge>
  );
}
