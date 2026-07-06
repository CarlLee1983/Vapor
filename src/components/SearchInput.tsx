import { forwardRef, useImperativeHandle, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export interface SearchInputHandle {
  focus: () => void;
}

export const SearchInput = forwardRef<SearchInputHandle, Props>(function SearchInput(
  { value, onChange, placeholder, ariaLabel },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  return (
    <div className="search-input">
      <input
        ref={inputRef}
        type="text"
        className="search-input__field"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="search-input__clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
});
