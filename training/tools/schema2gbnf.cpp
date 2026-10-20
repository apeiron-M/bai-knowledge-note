// Prints the GBNF that llama.cpp's server derives from a JSON schema
// (response_format json_schema), using the same common/ code as libllama
// b11364. Reads one JSON schema per stdin line, writes one JSON-encoded
// grammar string per stdout line.
#include "json-schema-to-grammar.h"
#include <iostream>
#include <string>

int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        try {
            auto schema = common_json::parse(line);
            std::cout << common_json(json_schema_to_grammar(schema)).dump() << "\n";
        } catch (const std::exception & e) {
            std::cout << common_json({{"error", e.what()}}).dump() << "\n";
        }
    }
    return 0;
}
