
import { AdminPanel } from "@/components/AdminPanel";

const Admin = () => {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Riksdagskoll Admin
          </h1>
          <p className="text-gray-600">
            Hantera API-synkronisering och systemkonfiguration
          </p>
        </div>
        
        <AdminPanel />
      </div>
    </div>
  );
};

export default Admin;
