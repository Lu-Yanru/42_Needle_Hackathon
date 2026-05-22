# knit.py

import sys
from os.path import exists
from argparse import ArgumentParser

def parse_input(file_path):
    try:
        with open(file_path, 'r') as file:
            return file.readlines()
    except FileNotFoundError:
        raise FileNotFoundError('Input file not found. Please provide a valid .knit file.')

def validate_statements(statements):
    for statement in statements:
        if not statement.strip():
            continue
        parts = statement.split()
        if len(parts) < 2 or parts[0] not in ['row', 'repeat']:
            raise ValueError(f'Invalid statement: {statement}')

def expand_brackets(statements):
    expanded_statements = []
    for statement in statements:
        if 'bracketed' in statement:
            count = int(statement.split()[1])
            expanded_statements.extend([statement.replace('bracketed', '')] * count)
        else:
            expanded_statements.append(statement)
    return expanded_statements

def simulate_stitch_counts(statements):
    stitch_count = 0
    start_row = None
    end_row = None
    for statement in statements:
        parts = statement.split()
        if parts[0] == 'row':
            if start_row is not None and end_row is not None:
                raise ValueError('Duplicate row without repeat range')
            start_row = int(parts[1])
        elif parts[0] == 'repeat':
            if start_row is None or end_row is not None:
                raise ValueError('Invalid repeat range')
            end_row = int(parts[2])
            stitch_count += (end_row - start_row + 1)
    return {'total_stitches': stitch_count}

def construct_output(simulation_results):
    return simulation_results

# Main function to handle parsing and simulation of knitting pattern instructions
def process_knit_pattern(file_path=None):
    try:
        if file_path is None or not exists(file_path):
            raise FileNotFoundError('Input file not found. Please provide a valid .knit file.')
        statements = parse_input(file_path)
        validate_statements(statements)
        expanded_statements = expand_brackets(statements)
        simulation_results = simulate_stitch_counts(expanded_statements)
        return construct_output(simulation_results)
    except FileNotFoundError:
        return {'error': 'Input file not found. Please provide a valid .knit file.'}
    except ValueError as e:
        return {'error': str(e)}

if __name__ == '__main__':
    parser = ArgumentParser(description='Knitting pattern simulator')
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    else:
        raise FileNotFoundError('Input file not found. Please provide a valid .knit file.')

    try:
        output = process_knit_pattern(input_file)
    except Exception as e:
        return {'error': str(e)}
    print(output)