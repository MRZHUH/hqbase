import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { SettingsSection } from "@/features/settings/settings-section";
import { formatDateTime } from "@/lib/format";

import { type ConnectedApp, listConnectedApps, revokeConnectedApp } from "./connected-apps-api";

const scopeLabels: Record<string, string> = {
  "mail:read": "Read mail",
  "mail:write": "Change mail state",
  "mail:send": "Send mail",
  offline_access: "Stay connected"
};

export function ConnectedAppsSettings(): React.ReactElement {
  const [apps, setApps] = React.useState<ConnectedApp[] | null>(null);
  const [pendingRevoke, setPendingRevoke] = React.useState<ConnectedApp | null>(null);
  const [revoking, setRevoking] = React.useState(false);

  const refresh = React.useCallback(
    () =>
      void listConnectedApps()
        .then(setApps)
        .catch((error) => {
          setApps([]);
          toast.error(
            error instanceof Error ? error.message : "Connected applications could not be loaded."
          );
        }),
    []
  );
  React.useEffect(refresh, [refresh]);

  async function confirmRevoke(): Promise<void> {
    if (!pendingRevoke) return;
    setRevoking(true);
    try {
      await revokeConnectedApp(pendingRevoke.clientId);
      toast.success(`${pendingRevoke.name} no longer has access.`);
      setPendingRevoke(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Access could not be revoked.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <SettingsSection
      description="Applications you authorized to reach this workspace on your behalf, such as the terminal client or an AI agent."
      title="Connected applications"
    >
      {apps === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No applications are connected. Authorizing one from a terminal client or an MCP client
          will list it here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Authorized</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((app) => (
                <TableRow key={app.clientId}>
                  <TableCell>
                    <div className="font-medium">{app.name}</div>
                    {app.uri ? (
                      <div className="text-xs text-muted-foreground">{app.uri}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {app.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {scopeLabels[scope] ?? scope}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(app.grantedAt)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {app.lastUsedAt ? formatDateTime(app.lastUsedAt) : "Never used"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      onClick={() => setPendingRevoke(app)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        open={pendingRevoke !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke access?</DialogTitle>
            <DialogDescription>
              {pendingRevoke?.name} will lose access to this workspace immediately and cannot reach
              your mail again until you authorize it a second time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingRevoke(null)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={revoking} onClick={() => void confirmRevoke()} type="button">
              {revoking ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
