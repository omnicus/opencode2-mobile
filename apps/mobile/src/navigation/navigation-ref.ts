import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./root-navigation";

export const rootNavigationRef = createNavigationContainerRef<RootStackParamList>();
