/**
 * Overrides for Swagger UI. Its default inline-code padding (5px 7px) is taller
 * than the line box, so code chips in descriptions overlap neighbouring lines.
 */
export const docsThemeCss = `
.swagger-ui .markdown code,
.swagger-ui .renderedMarkdown code {
  display: inline;
  padding: 0.1em 0.35em;
  font-size: 0.875em;
  font-weight: 500;
  line-height: inherit;
  white-space: nowrap;
  border-radius: 4px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.swagger-ui .info .markdown p,
.swagger-ui .info .markdown li,
.swagger-ui .renderedMarkdown p,
.swagger-ui .renderedMarkdown li {
  line-height: 1.7;
}
.swagger-ui .info .markdown li + li { margin-top: 2px; }

html.dark-mode .swagger-ui .markdown code,
html.dark-mode .swagger-ui .renderedMarkdown code {
  background: rgb(255 255 255 / 0.08);
  color: #c9a7ef;
}
`;
