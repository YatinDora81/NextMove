"use client"

import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useAuth } from "@clerk/nextjs"
import { useEffect, useState } from "react"
import { Role } from "@/utils/api_types"
import { GET_ALL_ROLES } from "@/utils/url"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Label } from "@radix-ui/react-label"

export function Roles_AutoComplete({ selectedRole , setSelectedRole }: { selectedRole: Role | null, setSelectedRole: (role: Role | null) => void }) {
  const [open, setOpen] = React.useState(false)
  

  const { getToken } = useAuth()
  const [roles, setRoles] = useState<Role[]>([])


  const getRoles = async () => {
    try {
      const response = await fetch(GET_ALL_ROLES, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getMyAuthToken('frontend_token')}`
        }
      })
      const data = await response.json()
      if (data.success) {
        setRoles(data.data)
      }
      else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error("Error fetching roles")
      console.log(error)
    }
  }

  React.useEffect(() => {
    getRoles()
  }, [])

  const getMyAuthToken = async (tokenName: string): Promise<string> => {
    const token = await getToken({ template: tokenName })
    if (token) {
      return token;
    }
    else {
      throw new Error("Token not found")
    }
  }

  return (
    <div className=" flex flex-col ">

    <Label htmlFor="roles">Role</Label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedRole
            ? roles.find((role) => role.id === selectedRole?.id)?.name
            : "Select Role..."}
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search framework..." />
          <CommandList>
            <CommandEmpty>No Roles found...</CommandEmpty>
            <CommandGroup>
              {roles.map((role) => (
                <CommandItem
                  key={role.id}
                  value={role.id}
                   onSelect={(currentValue) => {
                     if (selectedRole?.id === currentValue) {
                       setSelectedRole(null)
                     }
                     else {
                       const selectedRoleData = roles.find((role) => role.id === currentValue) as Role
                       setSelectedRole(selectedRoleData)
                     }
                     setOpen(false)
                   }}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedRole?.id === role.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {role.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  )
}