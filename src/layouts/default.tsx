import { Navbar } from "@/components/navbar";

export default function DefaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col h-screen">
      <Navbar />
      <main className="container mx-auto max-w-7xl flex-grow px-2 pb-5" style={{ height: "calc(100vh - 200px)" }}>{children}</main>
    </div>
  );
}
