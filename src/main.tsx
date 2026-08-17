import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MovieRatingApp from "../components/MovieRatingApp";
import dataset from "../data/movies.json";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MovieRatingApp dataset={dataset} />
  </StrictMode>,
);
