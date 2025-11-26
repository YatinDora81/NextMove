"use client"

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useState } from "react"
import { Role } from "@/utils/api_types"
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
import { useDevice } from "@/hooks/useDevice"

export function Roles_AutoComplete({ selectedRole, setSelectedRole, allRoles }: { selectedRole: Role | null, setSelectedRole: (role: Role | null) => void, allRoles: Role[] }) {
  const [open, setOpen] = useState(false)
  const { isLaptop } = useDevice()

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
              ? ( isLaptop ? allRoles.find((role) => role.id === selectedRole?.id)?.name : allRoles.find((role) => role.id === selectedRole?.id)?.name.slice(0, 10) + "..." )
              : "Select Role..."}
            <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput placeholder="Search Roles..." />
            <CommandList>
              <CommandEmpty>No Roles found...</CommandEmpty>
              <CommandGroup>
                {allRoles.map((role) => (
                  <CommandItem
                    key={role.id}
                    value={role.id}
                    onSelect={(currentValue) => {
                      if (selectedRole?.id === currentValue) {
                        setSelectedRole(null)
                      }
                      else {
                        const selectedRoleData = allRoles.find((role) => role.id === currentValue) as Role
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