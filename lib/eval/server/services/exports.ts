import "server-only";
import type { SampleData } from "../../domain/report";
import { generateDocx } from "../renderers/docx";
export const exportReport = (input: SampleData) => generateDocx(input);
