import { Route, Routes } from "react-router-dom";

import "leaflet/dist/leaflet.css";

//import IndexPage from "@/pages/index";
import MapPage from "@/pages/map";

function App() {
  return (
    <Routes>
      <Route element={<MapPage />} path="/" />
      {/* <Route element={<MapPage />} path="/map" /> */}
    </Routes>
  );
}

export default App;
