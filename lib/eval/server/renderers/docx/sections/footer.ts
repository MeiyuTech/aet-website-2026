/**
 * Footer Section Generator
 *
 * Creates page footer with page numbers
 */

import { Paragraph, TextRun, Footer, AlignmentType, PageNumber } from 'docx'
import { COLORS } from '@/lib/eval/server/renderers/docx/styles'

/**
 * Create the page footer with page number
 * Format: "Page X of Y"
 */
export function createPageFooter(draft = false): Footer {
    return new Footer({
        children: [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                    new TextRun({
                        text: draft ? 'DRAFT - For review only | Page ' : 'Page ',
                        size: 18,
                        color: COLORS.gray500,
                        font: 'Arial',
                    }),
                    new TextRun({
                        children: [PageNumber.CURRENT],
                        size: 18,
                        color: COLORS.gray500,
                        font: 'Arial',
                    }),
                    new TextRun({
                        text: ' of ',
                        size: 18,
                        color: COLORS.gray500,
                        font: 'Arial',
                    }),
                    new TextRun({
                        children: [PageNumber.TOTAL_PAGES],
                        size: 18,
                        color: COLORS.gray500,
                        font: 'Arial',
                    }),
                ],
            }),
        ],
    })
}
