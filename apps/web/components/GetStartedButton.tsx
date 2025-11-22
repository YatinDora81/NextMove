"use client"
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface GetStartedButtonProps {
    variant?: "default" | "outline" | "secondary";
    className?: string;
    size?: "default" | "sm" | "lg" | "icon";
    children?: React.ReactNode;
}

export default function GetStartedButton({ 
    variant = "default", 
    className, 
    size = "default",
    children = "Get Started Free"
}: GetStartedButtonProps) {
    const { isSignedIn } = useUser();
    const router = useRouter();

    const handleClick = () => {
        if (isSignedIn) {
            router.push("/generate");
        }
    };

    const buttonContent = (
        <>
            {children}
            {typeof children === "string" && children !== "Learn More" && <ArrowRight className="ml-2" />}
        </>
    );

    if (isSignedIn) {
        return (
            <Button
                variant={variant}
                size={size}
                className={cn(className)}
                onClick={handleClick}
            >
                {buttonContent}
            </Button>
        );
    }

    return (
        <SignInButton mode="modal">
            <Button
                variant={variant}
                size={size}
                className={cn(className)}
            >
                {buttonContent}
            </Button>
        </SignInButton>
    );
}

