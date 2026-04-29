#!/usr/bin/env bash
# Tear down the Azure Container Apps deployment now that OWL runs on
# Proxmox (LXC 102 + Cloudflare Tunnel).
#
# Run this once from a workstation that has the Azure CLI installed and
# is logged into the same subscription that owns the asos-rg resource
# group. It deletes the resource group, which removes the Container App,
# its Container Apps Environment, the Log Analytics workspace, the ACR,
# and any storage created for the deployment.
#
# Verify the RG name is correct first — the asos-rg name is the default
# from .github/workflows/deploy-azure.yml; change it here if your group
# is named differently.

set -euo pipefail

RG="${RG:-asos-rg}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI not installed. Install with:" >&2
  echo "  brew install azure-cli   # macOS" >&2
  exit 1
fi

echo "Using subscription:"
az account show --query "{name:name, id:id}" -o tsv || {
  echo "Not logged in. Run: az login" >&2
  exit 1
}

echo
echo "Resources currently in $RG:"
az resource list --resource-group "$RG" --query "[].{name:name,type:type}" -o table || true

echo
read -r -p "Delete the entire $RG resource group? [type DELETE to confirm] " confirm
if [ "$confirm" != "DELETE" ]; then
  echo "Aborted."
  exit 2
fi

az group delete --name "$RG" --yes --no-wait
echo "Deletion started. Track with: az group show --name $RG"
echo "When the group disappears, Azure billing for the OWL deployment is gone."
