import { TemplateProvider } from "@/hooks/useTemplates";
import TemplatesPage from "@/ui-pages/TemplatesPage";
import { Role } from "@/utils/api_types";
import { GET_ALL_ROLES } from "@/utils/url";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from 'next';
import { DeviceProvider } from "@/hooks/useDevice";

export const metadata: Metadata = {
  title: 'Templates | NextMoveApp',
  description: 'Manage your message templates for job applications',
};

export default async function Templates() {

  const { getToken } = await auth();
  const token = await getToken({ template: "frontend_token" })

  const res = await fetch(GET_ALL_ROLES, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  })
  const data = await res.json()


  return <DeviceProvider>
    <TemplateProvider>
      <TemplatesPage allRoles={data.data as Role[]} />
    </TemplateProvider>
  </DeviceProvider>
}

export const dynamic = 'force-dynamic';