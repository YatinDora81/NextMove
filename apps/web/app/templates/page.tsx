import { TemplateProvider } from "@/hooks/useTemplates";
import TemplatesPage from "@/ui-pages/TemplatesPage";
import { Role } from "@/utils/api_types";
import { GET_ALL_ROLES } from "@/utils/url";
import type { Metadata } from 'next';
import { DeviceProvider } from "@/hooks/useDevice";
import { getServerToken } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: 'Templates | NextMoveApp',
  description: 'Manage your message templates for job applications',
};

export default async function Templates() {
  const token = await getServerToken()

  if (!token) {
    redirect("/?popup=login&redirect_url=/templates")
  }

  const res = await fetch(GET_ALL_ROLES, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  })
  const data = await res.json()

  return (
    <DeviceProvider>
      <TemplateProvider>
        <TemplatesPage allRoles={data.data as Role[]} />
      </TemplateProvider>
    </DeviceProvider>
  )
}

export const dynamic = 'force-dynamic';
