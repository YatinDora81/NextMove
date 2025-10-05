"use client"

import AutoCompleteSearch from "./modals/AutoCompleteSearch"

const ModalContainer = ({ open = false, setOpen }: { open: boolean, setOpen: (val: boolean) => void }) => {


    return <div onClick={(e) => { e.stopPropagation(); setOpen(false) }} className=" w-full h-screen flex justify-center items-center  dark:backdrop-blur-[4px] backdrop-blur-[7px] absolute top-0 left-0 z-[111]">
        <AutoCompleteSearch setOpen={setOpen} searchFor="Role" />
    </div>
}

export default ModalContainer