import { useNavigate } from "react-router-dom";

export default function SelectorModulo() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0b0d17] text-white">
      <h1 className="text-3xl font-bold mb-8">Gastos Supply</h1>

      <div className="flex gap-6">
        <button
          onClick={() => navigate("/comercio-exterior")}
          className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-lg text-lg font-medium shadow"
        >
          Comercio Exterior
        </button>

        <button
          onClick={() => navigate("/gastos-nacionales")}
          className="bg-green-600 hover:bg-green-700 px-8 py-4 rounded-lg text-lg font-medium shadow"
        >
          Gastos Nacionales
        </button>
      </div>
    </div>
  );
}
