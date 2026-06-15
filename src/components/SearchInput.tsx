interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export function SearchInput({ value, onChange, placeholder, ariaLabel }: Props) {
  return (
    <div className="search-input">
      <input
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
}
