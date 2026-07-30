import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

it("shows the product promise", () => {
  render(<Home />);
  expect(
    screen.getByRole("heading", { name: /帮你弄懂复杂议题/ }),
  ).toBeInTheDocument();
});
