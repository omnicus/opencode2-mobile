import { jest } from "@jest/globals";
import mockSafeAreaContext from "react-native-safe-area-context/jest/mock";

// Jest has no native window to deliver safe-area measurements.
jest.mock("react-native-safe-area-context", () => mockSafeAreaContext);
