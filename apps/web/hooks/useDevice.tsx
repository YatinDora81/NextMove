"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";

type DeviceContextType = {
  isLaptop: boolean;
  setIsLaptop: (val: boolean) => void;
};

const DeviceContext = createContext<DeviceContextType | null>(null);

export const DeviceProvider = ({ children }: { children: ReactNode }) => {
  const [isLaptop, setIsLaptop] = useState<boolean>(false);

  useEffect(() => {
    const checkDevice = () => {
        setIsLaptop(window.innerWidth >= 1024);
    };


    checkDevice();

    window.addEventListener("resize", checkDevice);
    return () => window.removeEventListener("resize", checkDevice);
  }, []);

  return (
    <DeviceContext.Provider value={{ isLaptop, setIsLaptop }}>
      {children}
    </DeviceContext.Provider>
  );
};

export const useDevice = () => {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("Please wrap component with DeviceProvider");
  return ctx;
};